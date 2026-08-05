# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Every pipeline phase needs a turn ceiling, or a loop becomes a frozen UI.

Only the planner had one. A researcher that kept searching therefore never
stopped — observed on Nova 2 Lite re-issuing near-identical web_search queries
while the UI sat at 95% for six minutes with no error, because nothing failed.

The researcher's ceiling is derived from the depth's own search budget, since
that budget is what the prompt tells the model it may spend. A fixed ceiling
would contradict the instructions and cut off legitimate work on deeper settings.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def orch():
    """Load the orchestrator module without running its entrypoint."""
    for extra in (REPO_ROOT / "patterns" / "orchestrator-agent", REPO_ROOT / "patterns"):
        if str(extra) not in sys.path:
            sys.path.insert(0, str(extra))

    path = REPO_ROOT / "patterns" / "orchestrator-agent" / "orchestrator_agent.py"
    spec = importlib.util.spec_from_file_location("_orchestrator_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestResearcherCeiling:
    def test_derives_from_the_depth_search_budget(self, orch):
        for depth, cfg in orch.DEPTH_CONFIGS.items():
            budget = cfg["search_budget"]
            limit = orch._phase_turn_limit("researcher", budget)

            # Must clear the budget the prompt grants, or the ceiling would cut
            # off work the model was explicitly told it could do.
            assert limit > budget, f"{depth}: ceiling {limit} <= budget {budget}"

    def test_scales_with_depth(self, orch):
        quick = orch._phase_turn_limit("researcher", orch.DEPTH_CONFIGS["quick"]["search_budget"])
        standard = orch._phase_turn_limit("researcher", orch.DEPTH_CONFIGS["standard"]["search_budget"])
        deep = orch._phase_turn_limit("researcher", orch.DEPTH_CONFIGS["deep"]["search_budget"])

        assert quick < standard < deep

    def test_falls_back_when_no_budget_is_carried(self, orch):
        """A missing budget must still yield a finite ceiling, never None."""
        limit = orch._phase_turn_limit("researcher", None)

        assert isinstance(limit, int) and limit > 0


class TestEveryPhaseIsBounded:
    def test_known_phases_have_a_finite_ceiling(self, orch):
        for name in ("researcher", "synthesizer", "pdf_writer", "website_writer", "menu_designer"):
            limit = orch._phase_turn_limit(name)

            assert isinstance(limit, int) and limit > 0, name

    def test_an_unknown_phase_still_gets_a_ceiling(self, orch):
        """The default matters most: a new phase must not be unbounded by default."""
        assert orch._phase_turn_limit("some_future_phase") == orch.DEFAULT_PHASE_MAX_TURNS
        assert orch.DEFAULT_PHASE_MAX_TURNS > 0

    def test_the_synthesizer_needs_fewer_turns_than_the_researcher(self, orch):
        researcher = orch._phase_turn_limit("researcher", orch.DEPTH_CONFIGS["standard"]["search_budget"])
        synthesizer = orch._phase_turn_limit("synthesizer")

        # It writes from findings already gathered and only calls pdf_generator.
        assert synthesizer < researcher


class TestBudgetTravelsWithThePhase:
    def test_depth_adjustment_carries_the_budget_it_wrote_into_the_prompt(self, orch):
        """The ceiling and the prompt must not drift apart.

        The prompt states a number of searches; the ceiling is computed from the
        same value, so they cannot disagree.
        """
        for depth, cfg in orch.DEPTH_CONFIGS.items():
            phases = orch._apply_depth_to_phases(orch.AGENT_PHASES, depth)
            researcher = next(p for p in phases if p["name"] == "researcher")

            assert researcher["search_budget"] == cfg["search_budget"], depth
            assert f"MAXIMUM of {cfg['search_budget']} total" in researcher["prompt"], depth

    def test_depth_adjustment_does_not_mutate_the_shared_phase_definitions(self, orch):
        before = orch.AGENT_PHASES[0]["prompt"]

        orch._apply_depth_to_phases(orch.AGENT_PHASES, "deep")

        assert orch.AGENT_PHASES[0]["prompt"] == before
        assert "search_budget" not in orch.AGENT_PHASES[0]


class TestResearcherPromptDiscouragesLooping:
    def test_forbids_repeating_a_search(self, orch):
        """The turn ceiling bounds the damage; this addresses the cause."""
        for prompt in (orch.RESEARCHER_PROMPT, orch.GENERIC_RESEARCHER_PROMPT):
            assert "NEVER repeat a search" in prompt
            assert "ONCE" in prompt
