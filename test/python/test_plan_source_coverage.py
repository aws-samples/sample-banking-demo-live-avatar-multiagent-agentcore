# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Every research plan must draw on all three source lanes.

The plan card renders each sub-question under a lane — web, kb, or analysis.
The planner intermittently omits a lane (usually kb), which made a run look
like the agent skipped the knowledge base entirely. `_ensure_source_coverage`
is the deterministic backstop: it relabels a spare question so all three lanes
are represented, without ever emptying a lane that was already covered.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def orch():
    for extra in (REPO_ROOT / "patterns" / "orchestrator-agent", REPO_ROOT / "patterns"):
        if str(extra) not in sys.path:
            sys.path.insert(0, str(extra))
    path = REPO_ROOT / "patterns" / "orchestrator-agent" / "orchestrator_agent.py"
    spec = importlib.util.spec_from_file_location("_orchestrator_plan_coverage", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _plan(types):
    return {
        "research_topic": "t",
        "sub_questions": [
            {"id": i + 1, "question": f"Question {i}", "priority": "high", "type": t}
            for i, t in enumerate(types)
        ],
    }


def _types(plan):
    return [q["type"] for q in plan["sub_questions"]]


def test_missing_kb_lane_is_added(orch):
    plan = _plan(["web", "web", "analysis", "web"])
    orch._ensure_source_coverage(plan)
    assert set(_types(plan)) == {"web", "kb", "analysis"}


def test_kb_donor_prefers_prior_baseline_question(orch):
    # Two web questions; the one about prior/baseline material should become kb.
    plan = {
        "research_topic": "t",
        "sub_questions": [
            {"id": 1, "question": "What is the live Dallas market size?", "type": "web"},
            {"id": 2, "question": "What do prior baseline reports establish?", "type": "web"},
            {"id": 3, "question": "Recommend one strategy", "type": "analysis"},
        ],
    }
    orch._ensure_source_coverage(plan)
    kb_qs = [q for q in plan["sub_questions"] if q["type"] == "kb"]
    assert len(kb_qs) == 1
    assert "prior baseline" in kb_qs[0]["question"].lower()


def test_all_lanes_present_is_unchanged(orch):
    plan = _plan(["web", "kb", "analysis"])
    before = _types(plan)
    orch._ensure_source_coverage(plan)
    assert _types(plan) == before


def test_two_missing_lanes_both_added(orch):
    plan = _plan(["web", "web", "web", "web"])
    orch._ensure_source_coverage(plan)
    assert {"web", "kb", "analysis"} <= set(_types(plan))
    # web was the only lane, so it must survive alongside the two added lanes.
    assert "web" in _types(plan)


def test_unknown_type_normalized_then_covered(orch):
    plan = _plan(["mystery", "web", "analysis"])
    orch._ensure_source_coverage(plan)
    assert all(t in {"web", "kb", "analysis"} for t in _types(plan))
    assert set(_types(plan)) == {"web", "kb", "analysis"}


def test_too_few_questions_left_untouched(orch):
    # Fewer questions than lanes: covering all three would empty another lane,
    # so the planner's assignment is left as-is.
    plan = _plan(["web", "web"])
    orch._ensure_source_coverage(plan)
    assert _types(plan) == ["web", "web"]


def test_no_required_lane_drops_to_zero(orch):
    # kb present exactly once, everything else web. Adding analysis must not
    # steal the sole kb question.
    plan = _plan(["kb", "web", "web"])
    orch._ensure_source_coverage(plan)
    types = _types(plan)
    assert "kb" in types
    assert "analysis" in types
    assert "web" in types
