"""
LiveKit voice agent worker — Trinity Reserve Bank Relationship Manager.

Real-time speech-to-speech over WebRTC using LiveKit Agents + the AWS realtime
plugin (Amazon Nova Sonic 2, `amazon.nova-2-sonic-v1:0`). This worker replaces
the AgentCore-Runtime avatar (`patterns/avatar-agent/avatar_agent.py`) as the
voice backend when the `livekit` feature flag is enabled.

Architecture (shape A — ECS Fargate):
- A LiveKit media server (self-hosted, Fargate) proxies WebRTC audio between
  the browser and this worker.
- This worker is a long-lived Fargate service registered with the LiveKit
  server. For each room a browser joins, LiveKit dispatches `entrypoint()`.
- The worker bridges the room audio to Nova Sonic 2 and exposes the AgentCore
  Gateway tools over MCP (streamable HTTP) with a fresh M2M bearer token.

Credentials: the Fargate task role supplies AWS creds via the boto3 default
chain (used by the AWS realtime plugin for Bedrock and by `utils.auth` for
SSM / Secrets Manager). No static keys.

TENANT ISOLATION:
The AgentCore avatar injects the verified Cognito `sub` into every gateway tool
call via Strands `BeforeToolCallEvent` hooks (UserScopeHook / PipelineScopeHook).
Those hooks do not run here, because LiveKit reaches the gateway through its own
MCP layer, so this worker enforces the same contract itself: `_ScopedGatewayServer`
wraps each user-scoped tool and merges the runtime `user_id` over whatever the
model supplied. See `docs/kb-isolation.md`.

Until that existed nothing on this transport supplied a `user_id`, and the
gateway correctly refused: kb_search answered `caller-scope-required`,
retrieve_user_profile found no profile, and the Relationship Manager could not
see an account the Client Advisor had just opened for the same person.
"""

import asyncio
import json
import logging
import os

from livekit import rtc
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli, mcp
from livekit.agents.llm import function_tool
from livekit.plugins import aws
from persona_prompts import get_persona_prompt
from utils.auth import get_gateway_access_token
from utils.gateway_tools import USER_SCOPED_TOOLS, bare_tool_name
from utils.ssm import get_ssm_parameter

logger = logging.getLogger("livekit-agent")
logging.basicConfig(
    level=os.environ.get("LOGLEVEL", "INFO").upper(),
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
)

REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-2-sonic-v1:0")
DEFAULT_PERSONA = os.environ.get("PERSONA", "friendly")
# Nova Sonic voice id. This worker holds one voice for the life of the task:
# LiveKit rooms are joined before the client sends any preference, and the token
# endpoint carries no voice, so per-session switching is not available on this
# transport. Set via VOICE_ID (cdk.json -> context.livekit.voiceId).
VOICE_ID = os.environ.get("VOICE_ID", "tiffany")

# How long to wait for a gateway tool to answer.
#
# `MCPServerHTTP` defaults to 5 seconds, which is far shorter than the tools it
# is calling: the gateway targets are Lambdas configured for 60-900s
# (kb_search and web_search 300s, pdf_generator 900s), and a cold start alone
# can eat several seconds. Every call that ran long raised
#
#   McpError: Timed out while waiting for response to ClientRequest.
#             Waited 5.0 seconds.
#
# which surfaces to the user as the avatar going quiet — it asked for data,
# never got it, and had nothing to say. Nova Sonic recycles the session every
# 360s, so a result arriving after that is useless anyway; 120s sits inside
# that budget, covers a cold Lambda plus a knowledge-base or web search, and
# matches the value the LiveKit docs use in their own example.
GATEWAY_TOOL_TIMEOUT_SECONDS = float(os.environ.get("GATEWAY_TOOL_TIMEOUT_SECONDS", "120"))

# First-turn greeting. Nova Sonic is speech-to-speech; we prompt an opening line
# so the user hears the Relationship Manager without having to speak first.
GREETING_INSTRUCTIONS = (
    "Greet the user in one short sentence as the Trinity Reserve Bank relationship "
    "manager, then ask how you can help. Speak in English."
)


class _ScopedGatewayServer(mcp.MCPServerHTTP):
    """Gateway MCP server that injects the verified caller into every tool call.

    The Strands hooks that do this on the AgentCore path (UserScopeHook,
    PipelineScopeHook) do not run here — LiveKit reaches the gateway through its
    own MCP layer. So on this transport nothing supplied `user_id`, and every
    user-scoped tool refused: kb_search returned `caller-scope-required`,
    retrieve_user_profile reported no profile, and the Relationship Manager could
    not see an account the Client Advisor had just opened for the same person.

    Injection happens in `list_tools`, which is a documented extension point the
    plugin itself overrides for `allowed_tools`. Wrapping the tools rather than
    the client session matters: the session is replaced on reconnect, so a
    session-level patch would silently stop scoping mid-conversation.

    `pipelines` is set to every view the user owns rather than using
    archive_mode. kb_search filters by user_id independently, so this reads only
    this caller's own reports across their sections — which is what the persona
    promises — without taking on the archive view's fail-open semantics.
    """

    ALL_PIPELINES = ("strategy_research", "market_research", "services")

    def __init__(self, *args, user_id: str, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._user_id = user_id

    def _scope_for(self, tool_name: str) -> dict:
        bare = bare_tool_name(tool_name)
        if bare not in USER_SCOPED_TOOLS:
            return {}
        scope: dict = {"user_id": self._user_id}
        if bare == "kb_search":
            scope["pipelines"] = list(self.ALL_PIPELINES)
        return scope

    async def list_tools(self, *, tool_options=None):  # noqa: ANN001, ANN201 - plugin types
        tools = await super().list_tools(tool_options=tool_options)
        if not self._user_id:
            logger.warning("[LIVEKIT] No verified user_id — gateway tools will refuse scoped calls")
            return tools
        return [self._wrap(tool) for tool in tools]

    def _wrap(self, tool):  # noqa: ANN001, ANN202 - plugin types
        schema = tool.info.raw_schema
        scope = self._scope_for(schema["name"])
        if not scope:
            return tool

        async def impl(raw_arguments: dict) -> object:
            # Runtime value wins over anything the model supplied, which is the
            # whole point: a model-chosen user_id must never reach the gateway.
            merged = {**(raw_arguments or {}), **scope}
            return await tool(merged)

        return function_tool(
            impl,
            raw_schema=schema,
            flags=tool.info.flags,
            on_duplicate=tool.info.on_duplicate,
        )


def _build_gateway_toolset(user_id: str) -> mcp.MCPToolset:
    """Build the AgentCore Gateway MCP toolset with a fresh M2M bearer token.

    Mirrors `avatar_agent.create_gateway_mcp_client`: the gateway URL comes from
    SSM (`/{STACK_NAME}/gateway_url`) and the token from the Cognito
    client-credentials flow (`utils.auth.get_gateway_access_token`). The token
    is valid ~1h; it is fetched per worker job so each conversation starts with
    a fresh token. Sessions longer than the token lifetime are out of scope for
    the demo.
    """
    stack_name = os.environ.get("STACK_NAME")
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")

    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    access_token = get_gateway_access_token()
    logger.info(
        "[LIVEKIT] Gateway MCP toolset — url=%s token=%s... tool_timeout=%ss",
        gateway_url,
        access_token[:12],
        GATEWAY_TOOL_TIMEOUT_SECONDS,
    )

    return mcp.MCPToolset(
        id="gateway",
        mcp_server=_ScopedGatewayServer(
            gateway_url,
            headers={"Authorization": f"Bearer {access_token}"},
            transport_type="streamable_http",
            # Applies to each tool call. See GATEWAY_TOOL_TIMEOUT_SECONDS.
            client_session_timeout_seconds=GATEWAY_TOOL_TIMEOUT_SECONDS,
            user_id=user_id,
        ),
    )


# Topic the browser listens on for tool activity.
#
# Speech is already covered: the agents framework publishes both sides of the
# conversation as text streams on `lk.transcription`, so the transcript panel
# only needed a subscriber. Tool calls are not published by anything, which is
# why an answer containing a link or a generated image left no trace on screen —
# the avatar said it had produced something and the page never showed it.
TOOL_ACTIVITY_TOPIC = "trb.tool"

# Gateway tools arrive prefixed with their target, e.g.
# "website-generator___website_generator". The suffix is the real tool name and
# the only part worth showing a user.
GATEWAY_NAME_SEPARATOR = "___"

# A tool result only has to carry a URL or a small record for the UI to render a
# card. Full payloads (base64 images, whole HTML documents, long KB result sets)
# would bloat the data channel for no benefit, so results are truncated.
MAX_TOOL_OUTPUT_CHARS = 24_000


def _display_tool_name(name: str) -> str:
    return name.rsplit(GATEWAY_NAME_SEPARATOR, 1)[-1]


def _attach_tool_activity_publisher(session: AgentSession, room: rtc.Room) -> None:
    """Publish tool starts and results to the browser.

    Sent on a dedicated topic rather than piggybacking on the transcript so the
    client can render a tool card, a website link or an image without having to
    parse them out of spoken text — which cannot be done reliably, because Nova
    Sonic speaks a URL aloud rather than emitting it verbatim.
    """

    def publish(payload: dict) -> None:
        async def send() -> None:
            try:
                await room.local_participant.send_text(json.dumps(payload), topic=TOOL_ACTIVITY_TOPIC)
            except Exception:
                # Presentational only — never let this take down a conversation.
                logger.warning("[LIVEKIT] Could not publish tool activity", exc_info=True)

        asyncio.create_task(send())

    @session.on("tool_execution_updated")
    def _on_tool_update(ev) -> None:  # noqa: ANN001 - plugin event model
        update = ev.update
        if update.type == "tool_call_started":
            publish(
                {
                    "callId": update.function_call.call_id,
                    "name": _display_tool_name(update.function_call.name),
                    "status": "running",
                }
            )

    @session.on("function_tools_executed")
    def _on_tools_done(ev) -> None:  # noqa: ANN001
        # `function_tools_executed` carries the raw tool output, which
        # `tool_call_ended` does not — it only has the text meant to be spoken.
        # The raw output is what holds the image URL or website link.
        for call, output in ev.zipped():
            # A None output means the tool raised, most often the gateway MCP
            # call timing out; `is_error` covers a tool that returned a failure.
            failed = output is None or output.is_error
            text = "" if output is None else str(output.output or "")
            publish(
                {
                    "callId": call.call_id,
                    "name": _display_tool_name(call.name),
                    "status": "error" if failed else "done",
                    "output": text[:MAX_TOOL_OUTPUT_CHARS],
                }
            )


def _attach_session_logging(session: AgentSession) -> None:
    """Log the conversation's turning points at INFO.

    The AWS realtime plugin logs generation, tool calls and transcripts at
    DEBUG, so at INFO a healthy session and a mute one produce identical
    output: "Sent text message", then nothing. That made a report of "the
    avatar is non-responsive" impossible to confirm from CloudWatch — there was
    no way to tell whether the model had spoken, whether the user's speech had
    been heard, or whether a tool had stalled.

    These handlers cost nothing per session and make each of those visible
    without turning on DEBUG, which would also dump base64 audio frames.
    """

    @session.on("agent_state_changed")
    def _on_agent_state(ev) -> None:  # noqa: ANN001 - plugin event model
        logger.info("[LIVEKIT] agent state %s -> %s", ev.old_state, ev.new_state)

    @session.on("user_input_transcribed")
    def _on_transcript(ev) -> None:  # noqa: ANN001
        # Only final transcripts: interim results fire per word.
        if ev.is_final:
            logger.info("[LIVEKIT] heard user: %s", ev.transcript[:160])

    @session.on("function_tools_executed")
    def _on_tools(ev) -> None:  # noqa: ANN001
        # A None output means the tool produced nothing to send back — a raised
        # exception, most often the gateway MCP call timing out. Those are the
        # calls that leave the avatar with nothing to say, so name them.
        for call, output in ev.zipped():
            if output is None:
                logger.warning("[LIVEKIT] tool returned no output: %s", call.name)
            else:
                logger.info("[LIVEKIT] tool called: %s", call.name)

    @session.on("error")
    def _on_error(ev) -> None:  # noqa: ANN001
        logger.error("[LIVEKIT] session error: %s", ev.error)


def _resolve_user_id(ctx: JobContext) -> str:
    """Best-effort read of the verified caller identity from the room.

    The token Lambda sets the LiveKit participant `identity` to the Cognito
    `sub`, so the first remote participant's identity is the authenticated
    user. Returns an empty string if not yet available (the worker still runs;
    see the tenant-isolation note in the module docstring).
    """
    try:
        for participant in ctx.room.remote_participants.values():
            if participant.identity:
                return participant.identity
    except Exception:
        logger.warning("[LIVEKIT] Could not resolve participant identity", exc_info=True)
    return ""


async def entrypoint(ctx: JobContext) -> None:
    """LiveKit dispatches this once per room a browser joins."""
    await ctx.connect()

    user_id = _resolve_user_id(ctx)
    persona = os.environ.get("PERSONA", DEFAULT_PERSONA)
    logger.info(
        "[LIVEKIT] Session start: room=%s user_id=%s persona=%s model=%s region=%s",
        ctx.room.name,
        user_id or "<unknown>",
        persona,
        MODEL_ID,
        REGION,
    )

    system_prompt = get_persona_prompt(persona)

    session = AgentSession(
        # Without an explicit voice the plugin leaves it NOT_GIVEN and Nova Sonic
        # picks its own default, which is female. That made the UI voice selector
        # look broken on this transport: the dropdown only reaches the WebSocket
        # avatar runtime, never this worker.
        llm=aws.realtime.RealtimeModel(voice=VOICE_ID),
        # The verified identity is resolved above, before the toolset is built,
        # so every user-scoped gateway call carries it.
        tools=[_build_gateway_toolset(user_id)],
    )
    _attach_session_logging(session)
    _attach_tool_activity_publisher(session, ctx.room)

    await session.start(
        room=ctx.room,
        agent=Agent(instructions=system_prompt),
    )

    await session.generate_reply(instructions=GREETING_INSTRUCTIONS)


def _livekit_creds_present() -> bool:
    """True only when all three LiveKit Cloud values are set.

    On first deploy the `/{stack}/livekit` secret ships with empty
    placeholders (the operator populates it post-deploy). Without this guard
    the worker would fail to connect and crash-loop, tripping the ECS
    deployment circuit breaker so the service never stabilizes. Instead we
    idle (keeping the container healthy) until the secret is populated and the
    service is restarted.
    """
    return bool(
        os.environ.get("LIVEKIT_URL") and os.environ.get("LIVEKIT_API_KEY") and os.environ.get("LIVEKIT_API_SECRET")
    )


if __name__ == "__main__":
    import sys

    _cmd = sys.argv[1] if len(sys.argv) > 1 else ""

    # Only guard the runtime `start` command. Build-time subcommands like
    # `download-files` must run and exit normally, so they bypass the guard.
    if _cmd == "start" and not _livekit_creds_present():
        import time

        logger.warning(
            "[LIVEKIT] Credentials not configured (empty secret). Idling — "
            "populate /%s/livekit and restart this service to connect.",
            os.environ.get("STACK_NAME", "<stack>"),
        )
        while True:
            time.sleep(60)

    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
