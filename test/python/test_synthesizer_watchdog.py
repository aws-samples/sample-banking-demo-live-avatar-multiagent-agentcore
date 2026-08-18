# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""The synthesizer phase must not hang forever on a wedged PDF/image tool call.

The sequential phase loop runs the agent with a single blocking agent() call,
so a wedged Gateway tool (pdf_generator, image gen) used to freeze the run —
heartbeats kept the UI "live" while nothing progressed (observed: 30+ minutes).
A per-phase wall-clock cap plus an idle backstop now abandons the wedged phase.

When the PDF render is what wedged, the finished report still lives in the
pdf_generator tool *input* the model produced just before the stall.
`_render_report_payload_markdown` recovers that content so the timeout path can
deliver the report text instead of an empty run. These tests pin the recovery
renderer and the watchdog's configured deadlines.
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
    spec = importlib.util.spec_from_file_location("_orchestrator_watchdog", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# --- watchdog deadlines ----------------------------------------------------


def test_wall_clock_cap_clears_legit_synthesis(orch):
    # Synthesis can legitimately run "well over 15 min"; the cap must sit above
    # that so a healthy slow run is not aborted, while still bounding a hang.
    assert orch.SEQUENTIAL_PHASE_WALL_CLOCK_SEC["synthesizer"] >= 1200


def test_every_capped_phase_has_a_positive_deadline(orch):
    for phase, cap in orch.SEQUENTIAL_PHASE_WALL_CLOCK_SEC.items():
        assert cap > 0, phase
    assert orch.SEQUENTIAL_PHASE_WALL_CLOCK_DEFAULT_SEC > 0
    assert orch.SEQUENTIAL_PHASE_IDLE_TIMEOUT_SEC > 0


def test_idle_backstop_is_generous_enough_for_thinking(orch):
    # The synchronous agent emits no queue events during a long thinking gap,
    # so the idle backstop must be generous (minutes, not seconds) to avoid
    # false aborts. Wall clock is the primary bound.
    assert orch.SEQUENTIAL_PHASE_IDLE_TIMEOUT_SEC >= 300


# --- report recovery renderer ---------------------------------------------


def test_recovers_report_nested_under_report_key(orch):
    payload = {
        "topic": "Trinity Reserve Bank Strategy",
        "format": "research",
        "report": {
            "executive_summary": "Launch a Dallas bank adjacent to TXSE.",
            "key_findings": ["Segment on HNW clients", "Use a correspondent broker-dealer"],
        },
    }
    md = orch._render_report_payload_markdown(payload)
    assert "# Trinity Reserve Bank Strategy" in md
    assert "## Executive Summary" in md
    assert "Launch a Dallas bank adjacent to TXSE." in md
    assert "## Key Findings" in md
    assert "- Segment on HNW clients" in md


def test_recovers_flat_report_without_report_key(orch):
    payload = {
        "topic": "Flat Report",
        "executive_summary": "Summary text.",
        "recommendations": ["Do X", "Do Y"],
    }
    md = orch._render_report_payload_markdown(payload)
    assert "## Executive Summary" in md
    assert "## Recommendations" in md
    assert "- Do X" in md


def test_renders_dict_findings_with_confidence(orch):
    payload = {
        "report": {
            "key_findings": [
                {"title": "Fraud detection", "detail": "Use layered AI models", "confidence": "high"},
            ],
        }
    }
    md = orch._render_report_payload_markdown(payload)
    assert "**Fraud detection**" in md
    assert "Use layered AI models" in md
    assert "confidence: high" in md


def test_empty_or_bad_payload_returns_empty(orch):
    assert orch._render_report_payload_markdown(None) == ""
    assert orch._render_report_payload_markdown({}) == "# Research Report"
    assert orch._render_report_payload_markdown("not a dict") == ""


def test_falls_back_to_title_when_no_topic(orch):
    payload = {"report": {"title": "Derived Title", "executive_summary": "x"}}
    md = orch._render_report_payload_markdown(payload)
    assert "# Derived Title" in md


def test_skips_absent_sections(orch):
    payload = {"report": {"executive_summary": "only this"}}
    md = orch._render_report_payload_markdown(payload)
    assert "## Executive Summary" in md
    assert "## Methodology" not in md
    assert "## References" not in md
