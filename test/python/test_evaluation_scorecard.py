# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""The evaluator's markdown scorecard parses into structured Bedrock-eval props.

The evaluator phase runs a distinct Bedrock judge model and streams a
fixed-format markdown scorecard. `_parse_evaluation_scorecard` turns that table
into the props the EvaluationScorecard card and the flow-panel tile render.
Parsing must be robust to the bold markers the model emits and must never raise
into the pipeline, so the happy path, the metric mapping, criteria extraction,
and the no-table fallback are all asserted here.
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
    spec = importlib.util.spec_from_file_location("_orchestrator_eval_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# The exact shape the EVALUATION_PROMPT instructs the judge to emit.
SCORECARD = """## Evaluation Scorecard

| Dimension | Score | Notes |
|---|---|---|
| Alignment with brief | 88/100 | Covers KYC, accounts, fraud, staffing. |
| Comprehensiveness | 82/100 | Good depth on operations. |
| Groundedness | 91/100 | Claims tie to KB evidence. |
| Citations | 76/100 | A few claims lack resolvable sources. |
| Coherence | 90/100 | Clear structure. |
| **Overall** | **85/100** | Strong, ship with minor citation fixes. |

**Brief coverage:** KYC ✅ · Accounts ✅ · Fraud ✅

**Top gaps & recommended fixes:**
- Add sources for the salary-band figures.
- Tighten the European exchanges section.
"""


def test_parses_dimensions_overall_and_verdict(orch):
    card = orch._parse_evaluation_scorecard(SCORECARD, "us.amazon.nova-pro-v1:0", ["Covers the brief"])
    assert card is not None
    assert card["overall"] == 85
    assert card["verdict"] == "pass"  # 85 >= 80
    assert card["judgeModel"] == "us.amazon.nova-pro-v1:0"
    assert card["summary"].startswith("Strong")
    assert card["criteria"] == ["Covers the brief"]
    # Five scored dimensions; the Overall row is not a dimension.
    assert len(card["dimensions"]) == 5
    assert all("overall" not in d["label"].lower() for d in card["dimensions"])


def test_dimensions_map_to_bedrock_metric_names(orch):
    card = orch._parse_evaluation_scorecard(SCORECARD, "judge", [])
    by_key = {d["key"]: d for d in card["dimensions"]}
    assert by_key["groundedness"]["metricRef"] == "Faithfulness"
    assert by_key["alignment"]["metricRef"] == "Correctness"
    assert by_key["citations"]["metricRef"] == "Citation precision"
    assert by_key["comprehensiveness"]["metricRef"] == "Completeness"
    assert by_key["coherence"]["metricRef"] == "Coherence"


def test_top_gaps_extracted(orch):
    card = orch._parse_evaluation_scorecard(SCORECARD, "judge", [])
    assert len(card["gaps"]) == 2
    assert card["gaps"][0].startswith("Add sources")


def test_verdict_revise_below_threshold(orch):
    low = SCORECARD.replace("**85/100**", "**64/100**")
    card = orch._parse_evaluation_scorecard(low, "judge", [])
    assert card["overall"] == 64
    assert card["verdict"] == "revise"


def test_overall_derived_when_row_missing(orch):
    # Drop the Overall row; the parser averages the five dimensions (85.4 -> 85).
    no_overall = "\n".join(line for line in SCORECARD.splitlines() if "Overall" not in line)
    card = orch._parse_evaluation_scorecard(no_overall, "judge", [])
    assert card is not None
    assert card["overall"] == round((88 + 82 + 91 + 76 + 90) / 5)


def test_returns_none_without_table(orch):
    assert orch._parse_evaluation_scorecard("No scorecard here, just prose.", "judge", []) is None
    assert orch._parse_evaluation_scorecard("", "judge", []) is None


def test_extract_plan_criteria_from_plan_json(orch):
    plan_blob = (
        'Previous agent (planner) output:\n{"research_topic": "bank", '
        '"evaluation_criteria": ["Covers every deliverable", "Claims are grounded", '
        '"Converges on one recommendation"], "objectives": []}'
    )
    criteria = orch._extract_plan_criteria(plan_blob)
    assert criteria == [
        "Covers every deliverable",
        "Claims are grounded",
        "Converges on one recommendation",
    ]


def test_extract_plan_criteria_absent_returns_empty(orch):
    assert orch._extract_plan_criteria("no plan json here") == []
    assert orch._extract_plan_criteria("") == []
