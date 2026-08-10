"""Force-inject per-mode KB read filters and pdf_generator pipeline writes into MCP tool calls.

Each orchestrator mode maps to a logical pipeline taxonomy:
- Market Strategy (mode=research / research_execute) writes `strategy_research`
- Market Intelligence (mode=generic_research / generic_research_execute)
  writes `market_research`
- Services Catalog (mode=menu) writes `services` and reads from
  {strategy_research, market_research}
- Client Advisor (mode=chatbot) reads only `services`
- Compliance Archive (mode=archive_chat) reads everything (no pipeline filter). This is
  the only intentional fail-open path — and it is signalled explicitly by setting
  `tool_input["archive_mode"] = True` so kb_search has a positive flag to check.

Mode identifiers are deliberately unchanged. They are an internal contract between
the frontend chat engine and the orchestrator's dispatch, not user- or model-facing
text, so renaming them would add churn without changing what the demo shows.

The hook lets the runtime (not the LLM) control these scopes — mirroring UserScopeHook.

Isolation contract (enforced here + in gateway/tools/kb_search/handler.py):

1. Any mode other than archive_chat MUST inject a concrete `pipelines` list. An
   empty list is the fail-closed signal to kb_search — unfiltered reads are
   refused. This closes the previous fail-open path where unknown modes
   returned `read_filter=None` → no filter at all.
2. Archive mode is opt-in via the `is_archive` constructor flag. The hook sets
   `archive_mode=True` on the tool input so kb_search can verify it came from
   the runtime, not the LLM.
3. `pdf_generator` writes are tagged on known write modes; chatbot/archive
   never write.
"""

import logging
from typing import Any

from strands.hooks import BeforeToolCallEvent, HookProvider, HookRegistry

from utils.gateway_tools import bare_tool_name

logger = logging.getLogger(__name__)


# Valid pipeline tags — must stay in sync with gateway tools kb_search, pdf_generator, kb_ingest.
VALID_PIPELINES: frozenset[str] = frozenset({"strategy_research", "market_research", "services"})


# Mode → { "write": <pipeline or None>, "read_filter": <list[str] or None>, "archive": bool }.
# - `write` is the pipeline value injected into gateway_pdf_generator calls.
# - `read_filter` is the pipelines array injected into gateway_kb_search calls.
#   A `None` or empty `read_filter` is treated as "fail closed" UNLESS
#   `archive=True`, which signals the intentional fail-open for the report
#   archive view.
# - `archive` flags archive_chat mode so the hook can set `archive_mode=True`
#   on tool inputs (kb_search requires this positive signal to return
#   unfiltered results).
MODE_PIPELINE_CONFIG: dict[str, dict[str, Any]] = {
    "research": {"write": "strategy_research", "read_filter": ["strategy_research"], "archive": False},
    "research_execute": {
        "write": "strategy_research",
        "read_filter": ["strategy_research"],
        "archive": False,
    },
    "generic_research": {"write": "market_research", "read_filter": ["market_research"], "archive": False},
    "generic_research_execute": {
        "write": "market_research",
        "read_filter": ["market_research"],
        "archive": False,
    },
    # Services Catalog reads the two research corpora for market and regulatory
    # context but never reads `services`, so a generated catalog cannot feed
    # itself back in as evidence.
    "menu": {
        "write": "services",
        "read_filter": ["strategy_research", "market_research"],
        "archive": False,
    },
    # Client Advisor grounds in the services catalog AND the step-1 strategy
    # report, so its answers can be shown to be grounded in the Deep Research
    # Agent's PDF (a stated demo goal). It never writes to the KB. The strategy
    # report also carries staff/salary detail, which is exactly what the
    # guardrails / DLP demo is meant to block — reading it makes that demo real.
    "chatbot": {"write": None, "read_filter": ["services", "strategy_research"], "archive": False},
    "archive_chat": {"write": None, "read_filter": None, "archive": True},
}


def mode_config(mode: str) -> dict[str, Any]:
    """Return the pipeline config for a mode, with safe fail-closed fallback for unknowns.

    Unknown modes resolve to `{write: None, read_filter: None, archive: False}`,
    which — combined with the fail-closed hook — means kb_search receives
    `pipelines=[]` and refuses to return results. Callers who intend archive
    semantics must pass `mode="archive_chat"` explicitly.
    """
    return MODE_PIPELINE_CONFIG.get(mode, {"write": None, "read_filter": None, "archive": False})


class PipelineScopeHook(HookProvider):
    """Force-inject KB read filters + pdf_generator pipeline writes for a given mode.

    Both `write_pipeline` and `read_filter` accept either a static value OR a
    zero-arg callable that returns the current value at tool-call time. The
    callable form is used by the Voice Avatar so the user's chip-multi-select
    choice is honored mid-session without re-creating the agent.

    When `is_archive=True`, the hook sets `tool_input["archive_mode"] = True`
    on kb_search calls and skips `pipelines` injection entirely. This is the
    single opt-in to unfiltered reads; every other code path falls through to
    the fail-closed empty-list branch.
    """

    def __init__(
        self,
        write_pipeline=None,
        read_filter=None,
        is_archive: bool = False,
        report_ids=None,
    ) -> None:
        self._write_provider = self._as_provider(write_pipeline)
        self._read_provider = self._as_provider(read_filter)
        self._is_archive = bool(is_archive)
        # Static list or zero-arg callable, same contract as read_filter — the
        # callable form lets the pinned run change between turns without
        # rebuilding the agent.
        self._report_provider = self._as_provider(report_ids)

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
    def _coerce_report_ids(raw):
        """Normalize a report-id pin to a clean list of non-empty strings.

        Returns [] for anything unusable. An empty list means "do not pin" — it
        must NOT fail closed, because most modes never pin and would otherwise
        lose all retrieval.
        """
        if raw is None:
            return []
        if isinstance(raw, str):
            raw = [raw]
        if not isinstance(raw, list):
            logger.warning("pipeline_scope: report_ids must be list/str/None, got %r", type(raw).__name__)
            return []
        return [r.strip() for r in raw if isinstance(r, str) and r.strip()]

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
        return cleaned  # may be empty; caller decides whether that's fail-closed

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self._inject_pipeline)

    def _inject_pipeline(self, event: BeforeToolCallEvent) -> None:
        # Bare name: a gateway tool registers as "<prefix>_<target>___<tool>",
        # so comparing the full string matched nothing and this hook never
        # applied a filter. See gateway_tools.bare_tool_name.
        tool_name = bare_tool_name(event.tool_use["name"])
        tool_input: dict[str, Any] = event.tool_use["input"]

        if tool_name == "kb_search":
            if self._is_archive:
                # Positive archive signal. kb_search verifies this flag before
                # returning unfiltered results — the LLM cannot set it.
                tool_input["archive_mode"] = True
                logger.info("pipeline_scope: archive_mode=True on kb_search (runtime-authorized)")
                # Strip any LLM-supplied pipelines so they can't narrow the archive.
                tool_input.pop("pipelines", None)
                return

            read_filter = self._coerce_read(self._read_provider())
            original = tool_input.get("pipelines")
            if not read_filter:
                # Fail closed: no pipeline scope. Inject empty list so the
                # kb_search handler's scope check sees the runtime decision
                # (empty) rather than an LLM-supplied value. Combined with
                # archive_mode=False (default), kb_search returns no results.
                tool_input["pipelines"] = []
                logger.warning("pipeline_scope: fail-closed kb_search — no read_filter (mode misconfigured?)")
                return

            tool_input["pipelines"] = list(read_filter)
            if original and original != list(read_filter):
                logger.info(
                    "pipeline_scope: overriding LLM kb_search pipelines=%r with %r",
                    original,
                    read_filter,
                )
            else:
                logger.info("pipeline_scope: injected kb_search pipelines=%r", read_filter)

            # Pin retrieval to specific research run(s) when the caller supplied
            # them. This is what stops the AI Assistant grounding itself in a
            # semantic blend of every past run — two runs can recommend
            # contradictory rates, and mixing them produced a catalog that read
            # as one coherent report but was not.
            #
            # Always overwrite (never merge with an LLM-supplied value): the pin
            # is a runtime authorization decision, not a model choice.
            report_ids = self._coerce_report_ids(self._report_provider())
            if report_ids:
                tool_input["report_ids"] = report_ids
                logger.info("pipeline_scope: pinned kb_search report_ids=%r", report_ids)
            else:
                tool_input.pop("report_ids", None)
            return

        if tool_name == "pdf_generator":
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
