"""End-to-end test for the Voice Avatar KB chip selector.

The chip feature has three wires that must all work together:

1. Initial scope from the presigned URL — exercised via `_parse_kb_pipelines`
   on the `kb_pipelines` query-string param.
2. Mid-session `kbPipelinesChange` WebSocket message — mutates
   `kb_pipelines_holder[0]` so the PipelineScopeHook's callable read_filter
   picks up the new scope on the next kb_search call.
3. The PipelineScopeHook reads the holder by closure on every tool call,
   never caching.

This test drives #2 and #3 directly without standing up a real WebSocket
or BidiAgent — it constructs the same objects the handler does and
asserts the holder → hook → tool_input pipeline.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

# Load avatar_agent.py as a module. We can't just `from avatar_agent import ...`
# because the Python file is named `avatar_agent.py` (with underscore) but
# the directory is `avatar-agent` (with hyphen), so the package is unreachable.
_AVATAR_AGENT_PATH = Path(__file__).resolve().parents[2] / "patterns" / "avatar-agent" / "avatar_agent.py"


@pytest.fixture(autouse=True)
def _stub_avatar_env(monkeypatch):
    """Stub env vars the module-level code reads at import time."""
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("BEDROCK_REGION", "us-east-1")
    monkeypatch.setenv("STACK_NAME", "stub-stack")
    yield


@pytest.fixture
def avatar_module():
    """Load avatar_agent as a fresh module per test run."""
    module_name = "_test_avatar_agent"
    if module_name in sys.modules:
        del sys.modules[module_name]
    spec = importlib.util.spec_from_file_location(module_name, _AVATAR_AGENT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class TestParseKbPipelines:
    """The helper that normalizes kbPipelines from query string / JSON."""

    def test_comma_separated_string(self, avatar_module):
        result = avatar_module._parse_kb_pipelines("bistro_research,menu")
        assert result == ["bistro_research", "menu"]

    def test_comma_separated_with_whitespace(self, avatar_module):
        result = avatar_module._parse_kb_pipelines("bistro_research , menu")
        assert result == ["bistro_research", "menu"]

    def test_list_input(self, avatar_module):
        result = avatar_module._parse_kb_pipelines(["bistro_research", "menu"])
        assert result == ["bistro_research", "menu"]

    def test_empty_returns_none(self, avatar_module):
        assert avatar_module._parse_kb_pipelines("") is None
        assert avatar_module._parse_kb_pipelines([]) is None
        assert avatar_module._parse_kb_pipelines(None) is None

    def test_unknown_values_dropped(self, avatar_module):
        result = avatar_module._parse_kb_pipelines("bistro_research,bogus")
        assert result == ["bistro_research"]

    def test_all_unknown_returns_none(self, avatar_module):
        assert avatar_module._parse_kb_pipelines("bogus1,bogus2") is None


class TestHolderBackedPipelineScopeHook:
    """The avatar's _read_filter_provider closure pattern — a single-element
    list holder that the PipelineScopeHook reads by callable on every call.
    Mid-session mutations must take effect immediately on the next tool call.
    """

    def test_initial_value_flows_through(self, avatar_module, make_event):
        from pipeline_scope import PipelineScopeHook

        holder: list[list[str] | None] = [["bistro_research"]]

        def _provider():
            raw = holder[0] if holder else None
            if not raw:
                return list(avatar_module.VALID_PIPELINES)
            return raw

        hook = PipelineScopeHook(read_filter=_provider)
        event = make_event("gateway_kb_search")
        hook._inject_pipeline(event)
        assert event.tool_use["input"]["pipelines"] == ["bistro_research"]

    def test_mutation_picked_up_on_next_event(self, avatar_module, make_event):
        from pipeline_scope import PipelineScopeHook

        holder: list[list[str] | None] = [["bistro_research"]]

        def _provider():
            raw = holder[0] if holder else None
            if not raw:
                return list(avatar_module.VALID_PIPELINES)
            return raw

        hook = PipelineScopeHook(read_filter=_provider)

        # First call: bistro scope.
        e1 = make_event("gateway_kb_search")
        hook._inject_pipeline(e1)
        assert e1.tool_use["input"]["pipelines"] == ["bistro_research"]

        # Simulate kbPipelinesChange → holder[0] mutated in place.
        holder[0] = avatar_module._parse_kb_pipelines("menu")
        e2 = make_event("gateway_kb_search")
        hook._inject_pipeline(e2)
        assert e2.tool_use["input"]["pipelines"] == ["menu"]

        # Simulate "All" toggle → frontend sends empty list → holder becomes None.
        holder[0] = None
        e3 = make_event("gateway_kb_search")
        hook._inject_pipeline(e3)
        # Empty holder should expand to every valid pipeline (UI semantics).
        assert set(e3.tool_use["input"]["pipelines"]) == set(avatar_module.VALID_PIPELINES)

    def test_empty_holder_never_fails_closed(self, avatar_module, make_event):
        """Regression test for the Task 2 fail-closed interaction — empty holder
        must NOT trigger the `pipelines=[]` fail-closed path; it must expand
        to the full valid-pipeline set so normal avatar operation isn't broken."""
        from pipeline_scope import PipelineScopeHook

        holder: list[list[str] | None] = [None]

        def _provider():
            raw = holder[0] if holder else None
            if not raw:
                return list(avatar_module.VALID_PIPELINES)
            return raw

        hook = PipelineScopeHook(read_filter=_provider)
        event = make_event("gateway_kb_search")
        hook._inject_pipeline(event)
        assert event.tool_use["input"]["pipelines"] != []
        assert set(event.tool_use["input"]["pipelines"]) == set(avatar_module.VALID_PIPELINES)
