# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""The feedback summary turns raw signals into the continuous-loop dashboard.

Locks in the aggregation that powers the AI Assistant's feedback loop: approval
and edit rates, the signal mix, A/B model win-rates, and the auto-generated
recommendations that mirror AgentCore Evaluations' post-production insights.
"""

import importlib.util
import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def fb():
    os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
    path = REPO_ROOT / "lib" / "lambdas" / "feedback" / "index.py"
    spec = importlib.util.spec_from_file_location("_feedback_handler", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _rec(feedback_type, source, day, model=None, item=None):
    meta = {"source": source}
    if model:
        meta["model"] = model
    if item:
        meta["itemName"] = item
    return {
        "feedbackType": feedback_type,
        "metadata": meta,
        "createdAt": f"{day}T12:00:00+00:00",
        "timestamp": int(day.replace("-", "")),
    }


def test_totals_and_rates(fb):
    records = [
        _rec("positive", "catalog_rating", "2026-08-01"),
        _rec("positive", "edit", "2026-08-01"),
        _rec("positive", "edit", "2026-08-02"),
        _rec("negative", "catalog_rating", "2026-08-02"),
    ]
    out = fb._aggregate(records, days=30)
    assert out["totals"]["total"] == 4
    assert out["totals"]["positive"] == 3
    assert out["totals"]["negative"] == 1
    assert out["totals"]["approvalRate"] == pytest.approx(0.75)
    assert out["totals"]["editRate"] == pytest.approx(0.5)


def test_source_and_model_breakdown(fb):
    records = [
        _rec("positive", "ab_test", "2026-08-01", model="anthropic.claude"),
        _rec("positive", "ab_test", "2026-08-01", model="anthropic.claude"),
        _rec("positive", "ab_test", "2026-08-02", model="amazon.nova"),
        _rec("positive", "chat_rating", "2026-08-02"),
    ]
    out = fb._aggregate(records, days=30)
    sources = {s["source"]: s["count"] for s in out["bySource"]}
    assert sources["ab_test"] == 3
    assert sources["chat_rating"] == 1
    assert out["topModel"] == {"model": "anthropic.claude", "wins": 2}
    # Labels are humanized for the UI.
    labels = {s["source"]: s["label"] for s in out["bySource"]}
    assert labels["ab_test"] == "A/B winners"


def test_trend_is_zero_filled_and_trimmed(fb):
    records = [
        _rec("positive", "catalog_rating", "2026-08-01"),
        _rec("negative", "catalog_rating", "2026-08-03"),
    ]
    out = fb._aggregate(records, days=30)
    # Continuous daily buckets between first and last activity, no gaps.
    dates = [p["date"] for p in out["trend"]]
    assert dates == sorted(dates)
    assert any(p["positive"] == 1 for p in out["trend"])
    assert any(p["negative"] == 1 for p in out["trend"])
    # The month of empty leading days is trimmed away.
    assert len(out["trend"]) <= 5


def test_empty_state_has_a_prompt(fb):
    out = fb._aggregate([], days=30)
    assert out["totals"]["total"] == 0
    assert out["insights"]
    assert "No feedback" in out["insights"][0]["text"]


def test_ab_winner_insight(fb):
    records = [_rec("positive", "ab_test", "2026-08-01", model="amazon.nova") for _ in range(4)]
    out = fb._aggregate(records, days=30)
    texts = " ".join(i["text"] for i in out["insights"])
    assert "amazon.nova" in texts
    assert "A/B" in texts


def test_high_edit_rate_warns(fb):
    records = [_rec("positive", "edit", "2026-08-01") for _ in range(4)]
    records.append(_rec("positive", "catalog_rating", "2026-08-01"))
    out = fb._aggregate(records, days=30)
    tones = {i["tone"] for i in out["insights"]}
    assert "warning" in tones
