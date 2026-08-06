"""AgentCore Gateway toolset for the Tavus/Pipecat worker, with tenant isolation.

This is the Pipecat-side equivalent of `patterns/livekit-agent`'s
`_ScopedGatewayServer`. The Strands hooks that inject the verified caller on the
AgentCore path (UserScopeHook / PipelineScopeHook) do not run here, and the
LiveKit worker's MCP subclass is livekit-agents-specific, so this worker enforces
the same contract itself.

Why the raw `mcp` SDK instead of Pipecat's `MCPClient`: we must merge the
runtime `user_id` (and, for `kb_search`, the caller's pipelines) OVER whatever
the model supplied, so a model-chosen `user_id` can never reach the gateway.
Owning the tool handler is the only reliable place to do that. With no verified
`user_id`, scoped tools are not registered at all, so the gateway refuses them
exactly as it does on the LiveKit path (fail-closed).

Model-facing tool names are the bare suffix (e.g. `kb_search`), mapped back to
the full gateway name (e.g. `gateway_target___kb_search`) when calling. Bare
names keep the schema valid for Bedrock/Nova Sonic (no hyphens) and match what
the UI shows.
"""

import json
import logging

from mcp import ClientSession
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.frames.frames import OutputTransportMessageUrgentFrame
from scope import scope_for
from utils.gateway_tools import USER_SCOPED_TOOLS, bare_tool_name

logger = logging.getLogger("tavus-pipecat-agent")

# A tool result only needs to carry a URL or a small record for the UI to render
# a card; full payloads (base64 images, whole HTML docs) would bloat the data
# channel. Mirrors the LiveKit worker's cap.
MAX_TOOL_OUTPUT_CHARS = 24_000


def _content_to_text(result) -> str:
    """Render an MCP tool result's content blocks as a JSON string.

    An MCP tool returns content blocks, not a string. `json.dumps` keeps the
    payload valid on the wire so the browser's artifact parser can read a URL or
    record out of it (the LiveKit worker learned this the hard way — a Python
    repr is not JSON).
    """
    try:
        blocks = []
        for block in getattr(result, "content", None) or []:
            text = getattr(block, "text", None)
            blocks.append(text if text is not None else str(block))
        joined = "\n".join(blocks) if blocks else ""
        # If a block already looks like JSON, pass it through; else wrap it.
        return joined
    except Exception:  # noqa: BLE001 - never let serialization kill a turn
        return str(result)


class GatewayToolset:
    """Live gateway MCP session plus scoped Pipecat function registration."""

    def __init__(self, session: ClientSession, user_id: str) -> None:
        self._session = session
        self._user_id = user_id
        # Model-facing bare name -> full gateway tool name.
        self._name_map: dict[str, str] = {}

    async def discover(self) -> list[FunctionSchema]:
        """List gateway tools and build Bedrock-safe FunctionSchemas.

        User-scoped tools are omitted entirely when there is no verified
        `user_id`, so the model cannot even attempt an unscoped scoped call.
        """
        listed = await self._session.list_tools()
        schemas: list[FunctionSchema] = []
        for tool in listed.tools:
            bare = bare_tool_name(tool.name)
            if bare in USER_SCOPED_TOOLS and not self._user_id:
                logger.warning("[TAVUS] Omitting user-scoped tool %s — no verified user_id", bare)
                continue
            self._name_map[bare] = tool.name
            input_schema = tool.inputSchema or {}
            schemas.append(
                FunctionSchema(
                    name=bare,
                    description=(tool.description or bare),
                    properties=input_schema.get("properties", {}),
                    required=input_schema.get("required", []),
                )
            )
        logger.info("[TAVUS] Gateway tools available: %s", ", ".join(sorted(self._name_map)))
        return schemas

    def register(self, llm, task, is_nova_sonic: bool) -> None:
        """Register a scoped handler per discovered tool.

        Each handler publishes tool activity to the browser (running → done/error
        in the shape the LiveKit `trb.tool` topic used) and delivers the result
        to the model, including the Nova Sonic direct-result path.
        """
        for bare, full_name in self._name_map.items():
            self._register_one(llm, task, is_nova_sonic, bare, full_name)

    def _register_one(self, llm, task, is_nova_sonic: bool, bare: str, full_name: str) -> None:
        scope = scope_for(full_name, self._user_id)

        async def handler(params):  # noqa: ANN001 - Pipecat FunctionCallParams
            call_id = getattr(params, "tool_call_id", "") or ""
            model_args = params.arguments or {}
            # Runtime scope wins over anything the model supplied — the whole
            # point of tenant isolation.
            merged = {**model_args, **scope}

            await _publish(
                task,
                {
                    "callId": call_id,
                    "name": bare,
                    "status": "running",
                    "input": _truncate(_safe_json(model_args)),
                },
            )

            try:
                result = await self._session.call_tool(full_name, merged)
                failed = bool(getattr(result, "isError", False))
                text = _content_to_text(result)
            except Exception as exc:  # noqa: BLE001 - report, do not crash the turn
                logger.warning("[TAVUS] gateway tool %s failed: %s", bare, exc)
                failed = True
                text = f"Tool {bare} failed: {exc}"

            await _publish(
                task,
                {
                    "callId": call_id,
                    "name": bare,
                    "status": "error" if failed else "done",
                    "output": _truncate(text),
                },
            )

            result_text = text if not failed else f"The {bare} tool could not complete."
            await _deliver_result(llm, params, result_text, is_nova_sonic)

        llm.register_function(bare, handler)


def _safe_json(value) -> str:
    try:
        return json.dumps(value, default=str)
    except (TypeError, ValueError):
        return str(value)


def _truncate(text: str) -> str:
    return text[:MAX_TOOL_OUTPUT_CHARS]


async def _publish(task, payload: dict) -> None:
    """Send a tool-activity message on the data channel (presentational only)."""
    try:
        await task.queue_frames([OutputTransportMessageUrgentFrame(message={"type": "tool", **payload})])
    except Exception:  # noqa: BLE001 - never let UI publishing take down a turn
        logger.warning("[TAVUS] could not publish tool activity", exc_info=True)


async def _deliver_result(llm, params, result_text: str, is_nova_sonic: bool) -> None:
    """Deliver a tool result to the model.

    Nova Sonic never emits `BotStoppedSpeakingFrame`, so the aggregator path that
    Pipecat normally uses to return a tool result never fires. The reference
    handles this by sending the result straight into the bidirectional stream via
    the LLM's private `_send_tool_result`, guarded on `_completed_tool_calls`.
    We mirror that, and always call `result_callback` for the standard path.
    """
    await params.result_callback({"result": result_text})
    if not is_nova_sonic:
        return
    call_id = getattr(params, "tool_call_id", None)
    completed = getattr(llm, "_completed_tool_calls", None)
    if call_id is None or completed is None:
        return
    if call_id in completed:
        return
    try:
        await llm._send_tool_result(call_id, {"result": result_text})  # noqa: SLF001
        completed.add(call_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("[TAVUS] Nova Sonic _send_tool_result failed for %s: %s", call_id, exc)
