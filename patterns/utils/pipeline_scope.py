"""Force-inject per-mode KB read filters and pdf_generator pipeline writes into MCP tool calls.

Each orchestrator mode maps to a logical pipeline taxonomy:
- Bistro Deep Dive (mode=research / research_execute) writes `bistro_research`
- Open Research / Research Studio (mode=generic_research / generic_research_execute)
  writes `open_research`
- Menu Builder (mode=menu) writes `menu` and reads from {bistro_research, open_research}
- AI Concierge (mode=chatbot) reads only `menu`
- Report Archive (mode=archive_chat) reads everything (no filter)

The hook lets the runtime (not the LLM) control these scopes — mirroring UserScopeHook.
"""

import logging
from typing import Any

from strands.hooks import BeforeToolCallEvent, HookProvider, HookRegistry

logger = logging.getLogger(__name__)


# Valid pipeline tags — must stay in sync with gateway tools kb_search, pdf_generator, kb_ingest.
VALID_PIPELINES: frozenset[str] = frozenset({"bistro_research", "open_research", "menu"})


# Mode → { "write": <pipeline or None>, "read_filter": <list[str] or None> }.
# `write` is the pipeline value injected into gateway_pdf_generator calls.
# `read_filter` is the pipelines array injected into gateway_kb_search calls.
# A `None` read_filter means "no filter — read everything."
MODE_PIPELINE_CONFIG: dict[str, dict[str, Any]] = {
    "research": {"write": "bistro_research", "read_filter": ["bistro_research"]},
    "research_execute": {"write": "bistro_research", "read_filter": ["bistro_research"]},
    "generic_research": {"write": "open_research", "read_filter": ["open_research"]},
    "generic_research_execute": {"write": "open_research", "read_filter": ["open_research"]},
    "menu": {"write": "menu", "read_filter": ["bistro_research", "open_research"]},
    "chatbot": {"write": None, "read_filter": ["menu"]},
    "archive_chat": {"write": None, "read_filter": None},
}


def mode_config(mode: str) -> dict[str, Any]:
    """Return the pipeline config for a mode, with safe fallbacks for unknown modes."""
    return MODE_PIPELINE_CONFIG.get(mode, {"write": None, "read_filter": None})


class PipelineScopeHook(HookProvider):
    """Force-inject KB read filters + pdf_generator pipeline writes for a given mode.

    Both `write_pipeline` and `read_filter` accept either a static value OR a
    zero-arg callable that returns the current value at tool-call time. The
    callable form is used by the Voice Avatar so the user's chip-multi-select
    choice is honored mid-session without re-creating the agent.
    """

    def __init__(
        self,
        write_pipeline=None,
        read_filter=None,
    ) -> None:
        self._write_provider = self._as_provider(write_pipeline)
        self._read_provider = self._as_provider(read_filter)

    @staticmethod
    def _as_provider(value):
        """Return `value` itself if callable, else a lambda returning it."""
        if callable(value):
            return value
        return lambda _captured=value: _captured

    @staticmethod
    def _coerce_write(raw):
        if raw and raw in VALID_PIPELINES:
            return raw
        if raw:
            logger.warning("pipeline_scope: dropping unknown write_pipeline %r", raw)
        return None

    @staticmethod
    def _coerce_read(raw):
        if raw is None:
            return None
        if not isinstance(raw, list):
            logger.warning("pipeline_scope: read_filter must be list or None, got %r", type(raw).__name__)
            return None
        cleaned = [p for p in raw if p in VALID_PIPELINES]
        if len(cleaned) != len(raw):
            dropped = [p for p in raw if p not in VALID_PIPELINES]
            logger.warning("pipeline_scope: dropping unknown read_filter values %r", dropped)
        return cleaned if cleaned else None

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self._inject_pipeline)

    def _inject_pipeline(self, event: BeforeToolCallEvent) -> None:
        tool_name = event.tool_use["name"]
        tool_input: dict[str, Any] = event.tool_use["input"]

        if tool_name == "gateway_kb_search":
            read_filter = self._coerce_read(self._read_provider())
            if read_filter is None:
                # Explicit "no filter" → leave whatever the LLM/user supplied (usually nothing).
                return
            original = tool_input.get("pipelines")
            tool_input["pipelines"] = list(read_filter)
            if original and original != list(read_filter):
                logger.info(
                    "pipeline_scope: overriding LLM kb_search pipelines=%r with %r",
                    original,
                    read_filter,
                )
            else:
                logger.info("pipeline_scope: injected kb_search pipelines=%r", read_filter)
            return

        if tool_name == "gateway_pdf_generator":
            write_pipeline = self._coerce_write(self._write_provider())
            if not write_pipeline:
                return
            original = tool_input.get("pipeline")
            tool_input["pipeline"] = write_pipeline
            if original and original != write_pipeline:
                logger.info(
                    "pipeline_scope: overriding LLM pdf_generator pipeline=%r with %r",
                    original,
                    write_pipeline,
                )
            else:
                logger.info("pipeline_scope: injected pdf_generator pipeline=%r", write_pipeline)
            return
