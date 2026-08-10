# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""The researcher phase fans out across sub-questions instead of walking them.

The brief requires dividing the research into sections and running multi-agent
collaboration in parallel. A single researcher agent walking 12 sub-questions
one at a time is sequential by construction, so the plan is sharded across
concurrent sub-agents and their findings are merged back into the one JSON
document the synthesizer already consumes.

These tests cover the pure functions that make that safe: plan extraction,
sharding, and the fan-in merge. Getting the merge wrong silently drops research
the user paid for, so partial and malformed worker output is asserted on
explicitly.
"""

import importlib.util
import json
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
    spec = importlib.util.spec_from_file_location("_orchestrator_parallel_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _plan(*questions: str) -> str:
    return json.dumps(
        {
            "research_topic": "Trinity Reserve Bank strategy",
            "sub_questions": [
                {"id": i + 1, "question": q, "priority": "high", "type": "web"}
                for i, q in enumerate(questions)
            ],
        }
    )


class TestExtractSubQuestions:
    def test_reads_questions_from_a_plan(self, orch):
        text = _plan("KYC obligations?", "Deposit rate trends?", "Fraud detection?")
        assert orch._extract_sub_questions(text) == [
            "KYC obligations?",
            "Deposit rate trends?",
            "Fraud detection?",
        ]

    def test_reads_a_plan_nested_under_plan_key(self, orch):
        # research_execute wraps the approved plan, so the nested shape must work
        # or every execute run would silently fall back to sequential.
        wrapped = json.dumps({"plan": json.loads(_plan("A?", "B?"))})
        assert orch._extract_sub_questions(wrapped) == ["A?", "B?"]

    def test_tolerates_surrounding_prose(self, orch):
        text = "Here is the approved plan:\n" + _plan("A?", "B?") + "\nProceed."
        assert orch._extract_sub_questions(text) == ["A?", "B?"]

    def test_accepts_plain_string_questions(self, orch):
        text = json.dumps({"sub_questions": ["A?", "B?"]})
        assert orch._extract_sub_questions(text) == ["A?", "B?"]

    def test_returns_empty_when_unparseable(self, orch):
        # Empty is the caller's signal to run the sequential path, so it must
        # never raise — a bad plan should degrade, not fail the run.
        assert orch._extract_sub_questions("not json at all") == []
        assert orch._extract_sub_questions("") == []
        assert orch._extract_sub_questions(json.dumps({"no_questions": True})) == []


class TestSharding:
    def test_deals_round_robin_not_contiguously(self, orch):
        # Plans are written in priority order. Contiguous slicing would hand one
        # worker every high-priority question; dealing spreads them.
        shards = orch._shard_round_robin(["q1", "q2", "q3", "q4", "q5"], 2)
        assert shards == [["q1", "q3", "q5"], ["q2", "q4"]]

    def test_never_creates_more_shards_than_items(self, orch):
        shards = orch._shard_round_robin(["only"], 4)
        assert shards == [["only"]]

    def test_covers_every_question_exactly_once(self, orch):
        questions = [f"q{i}" for i in range(11)]
        shards = orch._shard_round_robin(questions, orch.MAX_RESEARCH_WORKERS)
        flat = [q for shard in shards for q in shard]
        assert sorted(flat) == sorted(questions)
        assert len(flat) == len(questions)

    def test_respects_the_worker_cap(self, orch):
        shards = orch._shard_round_robin([f"q{i}" for i in range(20)], orch.MAX_RESEARCH_WORKERS)
        assert len(shards) == orch.MAX_RESEARCH_WORKERS


class TestFanInMerge:
    def _worker(self, question: str, citation: str, insight: str) -> str:
        return json.dumps(
            {
                "questions_researched": [{"question": question, "detailed_findings": "..."}],
                "meta_analysis": {
                    "patterns": f"pattern for {question}",
                    "contradictions": "",
                    "evidence_strength": "strong",
                    "unexpected_findings": "",
                },
                "cross_references": f"xref {question}",
                "gaps": f"gap {question}",
                "key_insights": [insight],
                "citations": [citation],
            }
        )

    def test_merges_all_worker_questions_in_order(self, orch):
        merged = json.loads(
            orch._merge_research_findings(
                [
                    self._worker("Q1", "cite-1", "insight-1"),
                    self._worker("Q2", "cite-2", "insight-2"),
                ]
            )
        )
        assert [q["question"] for q in merged["questions_researched"]] == ["Q1", "Q2"]
        assert merged["parallel_execution"] == {"workers": 2, "questions_covered": 2}

    def test_dedupes_citations_and_insights(self, orch):
        # Two workers researching adjacent topics routinely cite the same source;
        # a duplicated references section looks like a bug in the report.
        merged = json.loads(
            orch._merge_research_findings(
                [
                    self._worker("Q1", "same-cite", "same-insight"),
                    self._worker("Q2", "same-cite", "same-insight"),
                ]
            )
        )
        assert merged["citations"] == ["same-cite"]
        assert merged["key_insights"] == ["same-insight"]

    def test_concatenates_meta_analysis_per_field(self, orch):
        merged = json.loads(
            orch._merge_research_findings(
                [self._worker("Q1", "c1", "i1"), self._worker("Q2", "c2", "i2")]
            )
        )
        assert "pattern for Q1" in merged["meta_analysis"]["patterns"]
        assert "pattern for Q2" in merged["meta_analysis"]["patterns"]

    def test_keeps_partial_results_when_a_worker_fails(self, orch):
        # A failed shard must not discard the shards that succeeded.
        merged = json.loads(orch._merge_research_findings([self._worker("Q1", "c1", "i1"), ""]))
        assert [q["question"] for q in merged["questions_researched"]] == ["Q1"]

    def test_preserves_unparseable_worker_output_as_notes(self, orch):
        merged = json.loads(
            orch._merge_research_findings([self._worker("Q1", "c1", "i1"), "I could not comply."])
        )
        assert merged["unstructured_worker_notes"] == ["I could not comply."]
        assert len(merged["questions_researched"]) == 1

    def test_caps_images_so_a_wide_fanout_cannot_flood_the_report(self, orch):
        payloads = [
            json.dumps({"images": [{"s3_key": f"img{i}a"}, {"s3_key": f"img{i}b"}]}) for i in range(4)
        ]
        merged = json.loads(orch._merge_research_findings(payloads))
        assert len(merged["images"]) == 3

    def test_empty_input_produces_a_valid_empty_document(self, orch):
        merged = json.loads(orch._merge_research_findings([]))
        assert merged["questions_researched"] == []
        assert merged["citations"] == []


class TestPaidSourceProvenance:
    """Purchased datasets must survive fan-in, or the spend is invisible."""

    def _worker_with_purchase(self, dataset_id: str, figure: str) -> str:
        return json.dumps(
            {
                "questions_researched": [{"question": f"Q about {dataset_id}"}],
                "paid_sources": [
                    {
                        "dataset_id": dataset_id,
                        "used_for": f"answering the {dataset_id} question",
                        "key_figures": [figure],
                    }
                ],
            }
        )

    def test_purchases_from_every_worker_are_merged(self, orch):
        merged = json.loads(
            orch._merge_research_findings(
                [
                    self._worker_with_purchase("deposit-benchmarks", "median 3.95% APY"),
                    self._worker_with_purchase("compensation-bands", "Branch Manager median $118k"),
                ]
            )
        )
        ids = {s["dataset_id"] for s in merged["paid_sources"]}
        assert ids == {"deposit-benchmarks", "compensation-bands"}

    def test_same_dataset_bought_twice_collapses_to_one_entry(self, orch):
        # Two workers can independently decide the same dataset is relevant.
        # Reporting it twice would overstate what the run actually spent.
        merged = json.loads(
            orch._merge_research_findings(
                [
                    self._worker_with_purchase("fraud-signals", "31.4% synthetic identity"),
                    self._worker_with_purchase("fraud-signals", "31.4% synthetic identity"),
                ]
            )
        )
        assert len(merged["paid_sources"]) == 1

    def test_key_figures_survive_the_merge(self, orch):
        # The figures are the whole point of the purchase; losing them means the
        # report cites a dataset it never actually uses.
        merged = json.loads(
            orch._merge_research_findings(
                [self._worker_with_purchase("exchange-activity", "TXSE 148 listings")]
            )
        )
        assert merged["paid_sources"][0]["key_figures"] == ["TXSE 148 listings"]

    def test_runs_that_bought_nothing_report_an_empty_list(self, orch):
        # An empty list is meaningful: it states the run spent nothing, which is
        # different from the field being absent.
        merged = json.loads(orch._merge_research_findings([json.dumps({"questions_researched": []})]))
        assert merged["paid_sources"] == []

    def test_malformed_paid_source_entries_are_dropped(self, orch):
        merged = json.loads(
            orch._merge_research_findings(
                [json.dumps({"paid_sources": ["not-a-dict", {"no_dataset_id": True}, {"dataset_id": ""}]})]
            )
        )
        assert merged["paid_sources"] == []


class TestPaidSourcePromptContract:
    """The prompt must route purchased figures into the structured output.

    Without this the model may mention a purchase in prose only, the synthesizer
    never sees it, and the money spent never reaches the PDF.
    """

    def test_addendum_requires_structured_reporting(self, orch, monkeypatch):
        monkeypatch.setenv("PAYMENT_MANAGER_ARN", "arn:pm")
        monkeypatch.setenv("PAYMENT_INSTRUMENT_ID", "pi-1")
        monkeypatch.setenv("X402_MERCHANT_URL", "https://example.com/x402")
        orch._payments_settings.cache_clear()
        addendum = orch._payment_prompt_addendum()
        try:
            assert "key_data_points" in addendum
            assert "paid_sources" in addendum
            assert 'PAID: <dataset-id>' in addendum
        finally:
            orch._payments_settings.cache_clear()

    def test_researcher_schema_exposes_paid_sources(self, orch):
        # The model needs a declared home for the field, or it invents one.
        assert "paid_sources" in orch.RESEARCHER_PROMPT

    def test_synthesizer_passes_paid_sources_into_the_report(self, orch):
        for prompt in (orch.SYNTHESIZER_PROMPT, orch.GENERIC_SYNTHESIZER_PROMPT):
            assert "paid_sources" in prompt


class TestWorkerPrompt:
    def test_scopes_the_worker_to_its_shard(self, orch):
        prompt = orch._worker_prompt("BASE PROMPT", ["Only this one?"], 2, 3, 12)
        assert "BASE PROMPT" in prompt
        assert "worker 2 of 3" in prompt
        assert "Only this one?" in prompt
        # The per-worker budget must appear, or workers each assume the full
        # budget and the run spends 4x the intended number of searches.
        assert "12 gateway_web_search calls" in prompt


class TestPhaseWiring:
    def test_both_research_pipelines_opt_into_parallel(self, orch):
        for phases in (orch.AGENT_PHASES, orch.GENERIC_RESEARCH_PHASES):
            researcher = next(p for p in phases if p["name"] == "researcher")
            assert researcher.get("parallel") is True

    def test_non_research_phases_stay_sequential(self, orch):
        # Synthesis and export depend on the complete findings document, so they
        # must never be sharded.
        for phases in (orch.AGENT_PHASES, orch.MENU_PHASES):
            for phase in phases:
                if phase["name"] != "researcher":
                    assert not phase.get("parallel")

    def test_worker_budget_never_starves_a_shard(self, orch):
        # A deep plan fanned out 4 ways must still leave each worker a usable
        # budget, and the floor guards the quick preset.
        for cfg in orch.DEPTH_CONFIGS.values():
            per_worker = max(
                orch.MIN_WORKER_SEARCH_BUDGET,
                cfg["search_budget"] // orch.MAX_RESEARCH_WORKERS,
            )
            assert per_worker >= orch.MIN_WORKER_SEARCH_BUDGET
