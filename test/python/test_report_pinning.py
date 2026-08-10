# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""The AI Assistant grounds itself in ONE research run, not all of them.

`kb_search` previously filtered on `user_id` + `pipeline` only, with no recency
bias and no run pinning. After five deep-research runs the catalog designer
retrieved chunks from all five, ranked purely by semantic similarity — so it
could take a deposit rate from run #1 and a segment strategy from run #3 that
contradicted it, and present both as one coherent report. That is a correctness
bug, not a cosmetic one.

The fix threads a per-run `report_id` from the PDF's S3 metadata into the KB
sidecar and then into the retrieval filter.

CAVEAT under test below: S3 Vectors only evaluates a filter clause against
documents that HAVE the key. Documents ingested before the stamp existed carry
no `report_id` and therefore PASS a `report_id` filter instead of being excluded
by it — the pin is only airtight after a KB reset and re-ingest.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def kb_search():
    return _load(REPO_ROOT / "gateway" / "tools" / "kb_search" / "handler.py", "_kb_search_pinning")


@pytest.fixture(scope="module")
def scope_mod():
    for extra in (REPO_ROOT / "patterns",):
        if str(extra) not in sys.path:
            sys.path.insert(0, str(extra))
    return _load(REPO_ROOT / "patterns" / "utils" / "pipeline_scope.py", "_pipeline_scope_pinning")


class TestFilterComposition:
    def test_report_id_alone_uses_equals(self, kb_search):
        assert kb_search._build_filter("", [], ["abc12345"]) == {
            "equals": {"key": "report_id", "value": "abc12345"}
        }

    def test_multiple_report_ids_use_in(self, kb_search):
        composed = kb_search._build_filter("", [], ["a1", "b2"])
        assert composed == {"in": {"key": "report_id", "value": ["a1", "b2"]}}

    def test_all_three_clauses_are_anded(self, kb_search):
        composed = kb_search._build_filter("user-1", ["strategy_research"], ["abc12345"])
        assert "andAll" in composed
        clauses = composed["andAll"]
        assert len(clauses) == 3
        keys = {list(c.values())[0]["key"] for c in clauses}
        assert keys == {"user_id", "pipeline", "report_id"}

    def test_absent_report_ids_leave_the_filter_unchanged(self, kb_search):
        # Every other mode must keep working exactly as before.
        without = kb_search._build_filter("user-1", ["services"])
        with_empty = kb_search._build_filter("user-1", ["services"], [])
        assert without == with_empty

    def test_blank_and_non_string_report_ids_are_dropped(self, kb_search):
        # A blank id would otherwise compose `report_id == ""`, which matches
        # nothing and would silently return an empty catalog.
        assert kb_search._build_filter("", [], ["  ", "", None, 5]) is None

    def test_report_ids_are_trimmed(self, kb_search):
        composed = kb_search._build_filter("", [], ["  abc12345  "])
        assert composed == {"equals": {"key": "report_id", "value": "abc12345"}}

    def test_no_scope_at_all_returns_none(self, kb_search):
        assert kb_search._build_filter("", [], []) is None


class TestScopeHookInjection:
    """The pin is a runtime authorization decision, never a model choice."""

    def _event(self, tool_name="gateway_kb-search___kb_search", tool_input=None):
        class _Event:
            def __init__(self, name, payload):
                self.tool_use = {"name": name, "input": payload if payload is not None else {}}

        return _Event(tool_name, tool_input)

    def test_pinned_report_is_injected(self, scope_mod):
        hook = scope_mod.PipelineScopeHook(
            read_filter=["strategy_research", "market_research"], report_ids=["abc12345"]
        )
        event = self._event()
        hook._inject_pipeline(event)
        assert event.tool_use["input"]["report_ids"] == ["abc12345"]

    def test_model_supplied_report_ids_are_overwritten(self, scope_mod):
        # The model must not be able to widen or redirect its own grounding.
        hook = scope_mod.PipelineScopeHook(read_filter=["services"], report_ids=["pinned1"])
        event = self._event(tool_input={"report_ids": ["attacker-chosen"]})
        hook._inject_pipeline(event)
        assert event.tool_use["input"]["report_ids"] == ["pinned1"]

    def test_model_supplied_report_ids_are_stripped_when_unpinned(self, scope_mod):
        # No pin configured means the model cannot introduce one either.
        hook = scope_mod.PipelineScopeHook(read_filter=["services"])
        event = self._event(tool_input={"report_ids": ["attacker-chosen"]})
        hook._inject_pipeline(event)
        assert "report_ids" not in event.tool_use["input"]

    def test_unpinned_modes_are_unaffected(self, scope_mod):
        hook = scope_mod.PipelineScopeHook(read_filter=["services"])
        event = self._event()
        hook._inject_pipeline(event)
        assert event.tool_use["input"]["pipelines"] == ["services"]
        assert "report_ids" not in event.tool_use["input"]

    def test_callable_pin_is_resolved_per_call(self, scope_mod):
        # Mirrors read_filter's provider contract so the pinned run can change
        # between turns without rebuilding the agent.
        current = {"id": "first"}
        hook = scope_mod.PipelineScopeHook(
            read_filter=["strategy_research"], report_ids=lambda: [current["id"]]
        )
        event = self._event()
        hook._inject_pipeline(event)
        assert event.tool_use["input"]["report_ids"] == ["first"]

        current["id"] = "second"
        event2 = self._event()
        hook._inject_pipeline(event2)
        assert event2.tool_use["input"]["report_ids"] == ["second"]

    def test_archive_mode_ignores_the_pin(self, scope_mod):
        # The Report Archive is meant to search across every run.
        hook = scope_mod.PipelineScopeHook(is_archive=True, report_ids=["abc12345"])
        event = self._event()
        hook._inject_pipeline(event)
        assert event.tool_use["input"]["archive_mode"] is True
        assert "report_ids" not in event.tool_use["input"]


class TestReportIdCoercion:
    def test_string_is_accepted_as_a_single_id(self, scope_mod):
        assert scope_mod.PipelineScopeHook._coerce_report_ids("abc") == ["abc"]

    def test_unusable_values_yield_no_pin_rather_than_failing_closed(self, scope_mod):
        # Empty means "do not pin". Failing closed here would delete all
        # retrieval for the many modes that never pin.
        for bad in (None, 42, {"a": 1}, [], ["", "  "]):
            assert scope_mod.PipelineScopeHook._coerce_report_ids(bad) == []
