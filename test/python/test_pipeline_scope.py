"""Tests for `patterns/utils/pipeline_scope.py::PipelineScopeHook`.

The hook is the runtime-side enforcement point for per-mode KB read filters
and pdf_generator write tags. These tests lock in the contract for every
mode in `MODE_PIPELINE_CONFIG` plus the unknown-mode fallback.

Task 1 baseline: the tests marked `xfail(strict=True)` document the current
fail-open behavior (no scope = unfiltered). Task 2 flips the hook to fail
closed; the `xfail(strict=True)` markers will then cause those tests to
start passing (pytest will report the xfail-passed case as a failure,
prompting us to remove the marker).
"""

from __future__ import annotations

import pytest
from pipeline_scope import MODE_PIPELINE_CONFIG, VALID_PIPELINES, PipelineScopeHook, mode_config


def _hook_for_mode(mode: str) -> PipelineScopeHook:
    """Build a PipelineScopeHook from a mode name, matching how the
    orchestrator constructs one in production.

    The MODE_PIPELINE_CONFIG dict uses `write`, `read_filter`, and `archive`
    keys, but the constructor takes `write_pipeline`, `read_filter`, and
    `is_archive`. The orchestrator does the mapping by hand (see the three
    PipelineScopeHook call sites in orchestrator_agent.py); centralize the
    same mapping here so every test doesn't repeat it.
    """
    cfg = mode_config(mode)
    return PipelineScopeHook(
        write_pipeline=cfg.get("write"),
        read_filter=cfg.get("read_filter"),
        is_archive=cfg.get("archive", False),
    )


class TestModeConfig:
    """`mode_config` returns per-mode dicts and a safe fallback for unknowns."""

    @pytest.mark.parametrize("mode", list(MODE_PIPELINE_CONFIG.keys()))
    def test_known_modes_return_explicit_config(self, mode):
        cfg = mode_config(mode)
        assert "write" in cfg
        assert "read_filter" in cfg

    def test_unknown_mode_returns_null_config(self):
        cfg = mode_config("not_a_real_mode")
        assert cfg == {"write": None, "read_filter": None, "archive": False}

    def test_empty_mode_returns_null_config(self):
        # This is the exact failure condition in orchestrator_agent.py line 1709
        # (plan-only research path doesn't pass mode="research"). Task 3 fixes
        # the caller, but the default fallback here is defensively null.
        cfg = mode_config("")
        assert cfg == {"write": None, "read_filter": None, "archive": False}


class TestPipelineScopeHookReadFilter:
    """Verifies the read-filter injection on gateway_kb_search."""

    def test_bistro_research_mode_injects_bistro_filter(self, make_event):
        hook = _hook_for_mode("research")
        event = make_event("gateway_kb_search")
        hook._inject_pipeline(event)
        assert event.tool_use["input"]["pipelines"] == ["bistro_research"]

    def test_open_research_mode_injects_open_filter(self, make_event):
        hook = _hook_for_mode("generic_research")
        event = make_event("gateway_kb_search")
        hook._inject_pipeline(event)
        assert event.tool_use["input"]["pipelines"] == ["open_research"]

    def test_menu_mode_allows_reads_from_both_research_pipelines(self, make_event):
        hook = _hook_for_mode("menu")
        event = make_event("gateway_kb_search")
        hook._inject_pipeline(event)
        assert event.tool_use["input"]["pipelines"] == ["bistro_research", "open_research"]

    def test_chatbot_mode_scopes_to_menu_only(self, make_event):
        hook = _hook_for_mode("chatbot")
        event = make_event("gateway_kb_search")
        hook._inject_pipeline(event)
        assert event.tool_use["input"]["pipelines"] == ["menu"]

    def test_hook_overrides_llm_supplied_pipelines(self, make_event):
        hook = _hook_for_mode("research")
        event = make_event("gateway_kb_search", pipelines=["menu"])
        hook._inject_pipeline(event)
        # LLM-supplied "menu" is overridden with the runtime's bistro scope
        assert event.tool_use["input"]["pipelines"] == ["bistro_research"]

    def test_unknown_pipeline_values_in_config_are_dropped(self, make_event):
        hook = PipelineScopeHook(read_filter=["bistro_research", "not_real"])
        event = make_event("gateway_kb_search")
        hook._inject_pipeline(event)
        assert event.tool_use["input"]["pipelines"] == ["bistro_research"]


class TestPipelineScopeHookArchiveMode:
    """Archive chat reads every pipeline — this is the one intentional
    fail-open path. The hook must set a positive `archive_mode=True` signal
    on the tool input so kb_search can verify it came from the runtime,
    not the LLM."""

    def test_archive_chat_sets_archive_mode_flag(self, make_event):
        hook = _hook_for_mode("archive_chat")
        event = make_event("gateway_kb_search")
        hook._inject_pipeline(event)
        assert event.tool_use["input"].get("archive_mode") is True

    def test_archive_chat_does_not_inject_pipelines(self, make_event):
        hook = _hook_for_mode("archive_chat")
        event = make_event("gateway_kb_search")
        hook._inject_pipeline(event)
        assert "pipelines" not in event.tool_use["input"]

    def test_archive_chat_strips_llm_supplied_pipelines(self, make_event):
        # The LLM cannot narrow the archive scope by supplying its own filter.
        hook = _hook_for_mode("archive_chat")
        event = make_event("gateway_kb_search", pipelines=["bistro_research"])
        hook._inject_pipeline(event)
        assert "pipelines" not in event.tool_use["input"]
        assert event.tool_use["input"].get("archive_mode") is True


class TestPipelineScopeHookWrite:
    """Verifies the pdf_generator write-pipeline tag."""

    def test_research_mode_tags_writes_as_bistro(self, make_event):
        hook = _hook_for_mode("research")
        event = make_event("gateway_pdf_generator")
        hook._inject_pipeline(event)
        assert event.tool_use["input"]["pipeline"] == "bistro_research"

    def test_generic_research_mode_tags_writes_as_open(self, make_event):
        hook = _hook_for_mode("generic_research")
        event = make_event("gateway_pdf_generator")
        hook._inject_pipeline(event)
        assert event.tool_use["input"]["pipeline"] == "open_research"

    def test_menu_mode_tags_writes_as_menu(self, make_event):
        hook = _hook_for_mode("menu")
        event = make_event("gateway_pdf_generator")
        hook._inject_pipeline(event)
        assert event.tool_use["input"]["pipeline"] == "menu"

    def test_chatbot_mode_does_not_inject_write_tag(self, make_event):
        # Chatbot shouldn't write to the KB at all; the hook has no write scope.
        hook = _hook_for_mode("chatbot")
        event = make_event("gateway_pdf_generator")
        hook._inject_pipeline(event)
        assert "pipeline" not in event.tool_use["input"]


class TestPipelineScopeHookCallableProviders:
    """The Voice Avatar passes a callable for `read_filter` so mid-session
    chip toggles take effect on the very next kb_search. Make sure that
    contract is solid."""

    def test_callable_provider_is_invoked_per_event(self, make_event):
        holder: list[list[str] | None] = [["menu"]]
        hook = PipelineScopeHook(read_filter=lambda: holder[0])

        event1 = make_event("gateway_kb_search")
        hook._inject_pipeline(event1)
        assert event1.tool_use["input"]["pipelines"] == ["menu"]

        # Mutate the holder; next event should see the new value.
        holder[0] = ["bistro_research", "open_research"]
        event2 = make_event("gateway_kb_search")
        hook._inject_pipeline(event2)
        assert event2.tool_use["input"]["pipelines"] == ["bistro_research", "open_research"]


class TestPipelineScopeHookFailClosed:
    """Task 2 contract: if the runtime cannot determine a valid filter and
    the mode is NOT archive_chat, the hook must fail closed by injecting an
    empty pipelines list. kb_search's entrypoint then refuses the call."""

    def test_unknown_mode_fails_closed_on_kb_search(self, make_event):
        hook = _hook_for_mode("not_a_real_mode")
        event = make_event("gateway_kb_search")
        hook._inject_pipeline(event)
        # Unknown modes get empty pipelines — kb_search handler refuses
        # the call since archive_mode is not set either.
        assert event.tool_use["input"].get("pipelines") == []
        assert event.tool_use["input"].get("archive_mode") is not True

    def test_empty_read_filter_fails_closed(self, make_event):
        # Caller supplied read_filter=[] explicitly (e.g., user deselected
        # every chip via a path that routes empty rather than all).
        hook = PipelineScopeHook(read_filter=[])
        event = make_event("gateway_kb_search")
        hook._inject_pipeline(event)
        assert event.tool_use["input"].get("pipelines") == []

    def test_callable_returning_none_fails_closed(self, make_event):
        hook = PipelineScopeHook(read_filter=lambda: None)
        event = make_event("gateway_kb_search")
        hook._inject_pipeline(event)
        assert event.tool_use["input"].get("pipelines") == []


def test_valid_pipelines_matches_backend_tools():
    """Guard against the frozenset drifting from the gateway handlers.

    kb_search/kb_ingest/pdf_generator all hard-code `{"bistro_research",
    "open_research", "menu"}`. The hook's VALID_PIPELINES must match.
    """
    assert VALID_PIPELINES == frozenset({"bistro_research", "open_research", "menu"})
