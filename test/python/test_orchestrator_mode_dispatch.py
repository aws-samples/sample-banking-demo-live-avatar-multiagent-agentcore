"""Regression tests for `patterns/orchestrator-agent/orchestrator_agent.py`
mode-dispatch wiring.

The pipeline-scope guarantee depends on every call to the internal runners
(`_run_plan_only`, `_run_pipeline`) passing a concrete `mode` argument. If
a caller forgets `mode=...`, the runner's default `mode=""` falls through
to `MODE_PIPELINE_CONFIG`'s unknown-mode fallback, which now fails closed
— but that still means the wrong UX: the experience silently returns
empty results instead of searching the right pipeline.

This file uses Python's AST to parse the orchestrator and walk every
call-site, asserting that `mode=` is supplied. An AST test beats a grep
because it's robust to whitespace, line continuations, and embedded
comments.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

ORCHESTRATOR_PATH = Path(__file__).resolve().parents[2] / "patterns" / "orchestrator-agent" / "orchestrator_agent.py"

# Functions whose callers must supply mode=. Keep in sync with the runners
# in orchestrator_agent.py. If you add a new mode-dispatched runner, add it
# here so the guarantee extends to it automatically.
MODE_REQUIRED_RUNNERS = {"_run_plan_only", "_run_pipeline"}


def _find_runner_calls(path: Path) -> list[tuple[str, int, ast.Call]]:
    """Return every Call node targeting a MODE_REQUIRED_RUNNERS function.

    The orchestrator also yields from inner awaitables — we care about the
    outermost Call AST node since that's where the kwargs live.
    """
    tree = ast.parse(path.read_text())
    calls: list[tuple[str, int, ast.Call]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name: str | None = None
        if isinstance(func, ast.Name):
            name = func.id
        elif isinstance(func, ast.Attribute):
            name = func.attr
        if name in MODE_REQUIRED_RUNNERS:
            calls.append((name, node.lineno, node))
    return calls


class TestModeArgumentEnforcement:
    """Every call to a mode-dispatched runner must pass `mode=`.

    This is a regression test for the Bistro Deep Dive planner scope leak
    (orchestrator_agent.py line 1709 before Task 3) where `_run_plan_only`
    was called without `mode="research"`, silently routing the planner's
    kb_search to the unscoped fallback.
    """

    def test_orchestrator_is_readable(self):
        assert ORCHESTRATOR_PATH.exists(), f"orchestrator not found: {ORCHESTRATOR_PATH}"

    def test_every_runner_call_passes_mode_kwarg(self):
        missing: list[str] = []
        for name, lineno, call in _find_runner_calls(ORCHESTRATOR_PATH):
            has_mode = any(kw.arg == "mode" for kw in call.keywords)
            if not has_mode:
                missing.append(f"{name}() at line {lineno} missing mode= kwarg")
        assert not missing, "\n".join(missing)

    def test_at_least_one_runner_call_exists(self):
        # Sanity check: if we changed the orchestrator so drastically that
        # no runner calls remain, the test above would pass vacuously. Fail
        # loudly in that case.
        calls = _find_runner_calls(ORCHESTRATOR_PATH)
        assert len(calls) >= 3, f"Expected >=3 runner calls (plan-only + research_execute + menu), found {len(calls)}"


class TestMode3RegressionHappyCases:
    """Direct assertions for the specific call sites Task 3 verifies."""

    @pytest.fixture
    def calls(self):
        return _find_runner_calls(ORCHESTRATOR_PATH)

    def test_all_run_plan_only_calls_have_mode(self, calls):
        plan_only_calls = [c for c in calls if c[0] == "_run_plan_only"]
        assert len(plan_only_calls) >= 2, "Expected research + generic_research plan-only call sites"
        for _name, lineno, call in plan_only_calls:
            mode_kw = next((kw for kw in call.keywords if kw.arg == "mode"), None)
            assert mode_kw is not None, f"_run_plan_only at line {lineno} missing mode="
            # mode must be a string literal, not a bare variable — prevents
            # sneaking mode='' through in an indirect way.
            assert isinstance(mode_kw.value, ast.Constant) and isinstance(mode_kw.value.value, str), (
                f"_run_plan_only at line {lineno} passes mode as non-literal"
            )
            assert mode_kw.value.value, f"_run_plan_only at line {lineno} passes empty mode"
