# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""analyze_patterns must read AgentCore Memory, not a graph nobody writes.

This tool previously queried Neptune Analytics. That graph is written only by
save_memory's fallback path, and `neptune` is false in cdk.json, so
NEPTUNE_ENDPOINT was never set and every call returned
"NEPTUNE_ENDPOINT environment variable not configured" — a registered tool that
could not work, surfacing an infrastructure error mid-conversation. It had no
test, which is how that survived.
"""

import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

USER = "cognito-sub-1234"


@pytest.fixture
def tool(load_tool, monkeypatch):
    monkeypatch.setenv("MEMORY_ID", "mem-123")
    module = load_tool("analyze_patterns")
    monkeypatch.setattr(module, "MEMORY_ID", "mem-123")
    return module


def _stub_tiers(module, monkeypatch, events, records):
    monkeypatch.setattr(module.agentcore_memory, "short_term_events", lambda *a, **k: events)
    monkeypatch.setattr(module.agentcore_memory, "long_term_records", lambda *a, **k: records)


def _event(text, session="s-1", timestamp="2026-08-05T09:30:00+00:00", role="USER"):
    return {"content": text, "role": role, "timestamp": timestamp, "session_id": session}


def _record(text, strategy="strat-9", timestamp="2026-08-05T09:31:00+00:00"):
    return {"content": text, "timestamp": timestamp, "strategy_id": strategy, "score": 0.5}


class TestSummary:
    def test_counts_sessions_and_exchanges_from_short_term(self, tool, monkeypatch):
        _stub_tiers(
            tool,
            monkeypatch,
            events=[
                _event("hello", session="s-1", timestamp="2026-08-05T09:00:00+00:00"),
                _event("again", session="s-1", timestamp="2026-08-05T09:05:00+00:00"),
                _event("new one", session="s-2", timestamp="2026-08-05T10:00:00+00:00"),
            ],
            records=[],
        )

        summary = tool._analyze(USER, "mem-123")["short_term"]

        assert summary["sessions"] == 2
        assert summary["exchanges"] == 3
        assert summary["first_activity"] == "2026-08-05T09:00:00+00:00"
        assert summary["last_activity"] == "2026-08-05T10:00:00+00:00"

    def test_groups_long_term_records_by_strategy(self, tool, monkeypatch):
        _stub_tiers(
            tool,
            monkeypatch,
            events=[],
            records=[_record("a", "semantic"), _record("b", "semantic"), _record("c", "episodic")],
        )

        long_term = tool._analyze(USER, "mem-123")["long_term"]

        assert long_term["records"] == 3
        assert long_term["by_strategy"] == {"semantic": 2, "episodic": 1}

    def test_attributes_records_with_no_strategy(self, tool, monkeypatch):
        _stub_tiers(tool, monkeypatch, events=[], records=[_record("a", strategy="")])

        assert tool._analyze(USER, "mem-123")["long_term"]["by_strategy"] == {"unattributed": 1}

    def test_truncates_long_content_in_previews(self, tool, monkeypatch):
        _stub_tiers(tool, monkeypatch, events=[_event("x" * 500)], records=[_record("y" * 500)])

        analysis = tool._analyze(USER, "mem-123")

        assert len(analysis["short_term"]["recent"][0]["content"]) == tool.CONTENT_PREVIEW_CHARS
        assert len(analysis["long_term"]["extracted"][0]["content"]) == tool.CONTENT_PREVIEW_CHARS


class TestHonestEmptyStates:
    def test_no_history_says_so_without_erroring(self, tool, monkeypatch):
        """A chatbot turn should stay graceful for a first-time user."""
        _stub_tiers(tool, monkeypatch, events=[], records=[])

        analysis = tool._analyze(USER, "mem-123")

        assert analysis["short_term"]["exchanges"] == 0
        assert analysis["long_term"]["records"] == 0
        assert "No conversation history" in analysis["note"]

    def test_events_without_records_explains_the_async_lag(self, tool, monkeypatch):
        """Otherwise this reads as "nothing was remembered", which is misleading."""
        _stub_tiers(tool, monkeypatch, events=[_event("hello")], records=[])

        assert "extraction has not produced records yet" in tool._analyze(USER, "mem-123")["note"]

    def test_no_note_once_both_tiers_have_data(self, tool, monkeypatch):
        _stub_tiers(tool, monkeypatch, events=[_event("hello")], records=[_record("a")])

        assert "note" not in tool._analyze(USER, "mem-123")


class TestHandlerGuards:
    def _ctx(self, lambda_context):
        return lambda_context("analyze_patterns")

    def test_refuses_without_a_verified_caller(self, tool, lambda_context):
        resp = tool.handler({}, self._ctx(lambda_context))

        assert "user_id" in resp["error"]

    def test_reports_a_missing_memory_id(self, tool, lambda_context, monkeypatch):
        monkeypatch.setattr(tool, "MEMORY_ID", "")

        resp = tool.handler({"user_id": USER}, self._ctx(lambda_context))

        assert "MEMORY_ID" in resp["error"]

    def test_returns_json_content(self, tool, lambda_context, monkeypatch):
        _stub_tiers(tool, monkeypatch, events=[_event("hello")], records=[_record("a")])

        resp = tool.handler({"user_id": USER}, self._ctx(lambda_context))

        body = json.loads(resp["content"][0]["text"])
        assert body["user_id"] == USER
        assert "short_term" in body and "long_term" in body


def test_the_dead_neptune_path_is_gone():
    """Guard against reinstating a backend nothing writes to.

    It also interpolated user_id straight into openCypher, unlike its
    parameterized siblings.
    """
    source = (REPO_ROOT / "gateway" / "tools" / "analyze_patterns" / "handler.py").read_text()

    # Assert on code, not prose — the module docstring documents the removal.
    assert 'os.environ.get("NEPTUNE_ENDPOINT"' not in source
    assert "_execute_neptune_query" not in source
    assert "SigV4Auth" not in source
    assert "urllib" not in source
    assert "MATCH (u:User" not in source

    spec = json.loads((REPO_ROOT / "gateway" / "tools" / "analyze_patterns" / "tool_spec.json").read_text())
    assert "neptune" not in spec[0]["description"].lower()
