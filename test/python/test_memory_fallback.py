"""Tests for the `recall_memories` handler fallback.

The contract is:
  1. Prefer AgentCore Memory's retrieve_memory_records / events when MEMORY_ID
     is set.
  2. Fall back to Neptune with parameterized openCypher when NEPTUNE_ENDPOINT
     is set.
  3. Report `{"status": "unavailable"}` — not an error — when neither is set.

Also asserts the Neptune fallback path uses $var bindings, not string
interpolation of LLM-controlled content.
"""

from __future__ import annotations

import json
from unittest.mock import patch


class TestRecallMemoriesFallbackChain:
    def _ctx(self, lambda_context):
        return lambda_context("recall_memories")

    def test_unavailable_when_no_backends(self, load_tool, lambda_context, monkeypatch):
        monkeypatch.delenv("MEMORY_ID", raising=False)
        mod = load_tool("recall_memories")
        monkeypatch.setattr(mod, "NEPTUNE_ENDPOINT", "")

        resp = mod.handler({"user_id": "alice", "query": "food"}, self._ctx(lambda_context))
        body = json.loads(resp["content"][0]["text"])
        assert body["status"] == "unavailable"
        assert body["memories"] == []
        assert "No memory backend configured" in body["reason"]

    def test_agentcore_success_returns_long_term_records(self, load_tool, lambda_context, monkeypatch):
        """This test used to assert `/actors/alice/` and pass while nothing worked.

        `namespace` is a strict prefix filter and the strategies live under
        `/strategies/{memoryStrategyId}/actors/{actorId}/`, so that prefix matched
        no record. The stub returned `memoryRecords`, a key the API does not have,
        which made the assertion self-consistent and meaningless. The namespace and
        field contract now lives in test_recall_namespace_scope; this covers the
        handler's own behaviour.
        """
        monkeypatch.setenv("MEMORY_ID", "mem-123")
        mod = load_tool("recall_memories")

        monkeypatch.setattr(
            mod.agentcore_memory,
            "long_term_records",
            lambda *a, **k: [
                {
                    "content": "user prefers paperless statements",
                    "timestamp": "2026-01-01T00:00:00Z",
                    "strategy_id": "strat-9",
                    "score": 0.9,
                }
            ],
        )
        monkeypatch.setattr(mod.agentcore_memory, "short_term_events", lambda *a, **k: [])

        resp = mod.handler(
            {"user_id": "alice", "query": "statements", "limit": 5},
            self._ctx(lambda_context),
        )

        body = json.loads(resp["content"][0]["text"])
        assert body["backend"] == "agentcore"
        assert body["count"] == 1
        assert body["memories"][0]["content"] == "user prefers paperless statements"
        assert body["memories"][0]["tier"] == "long_term"

    def test_short_term_covers_a_memory_saved_before_extraction_ran(self, load_tool, lambda_context, monkeypatch):
        """Extraction is asynchronous, so a just-saved memory is only an event.

        A long-term-only reader answers "nothing" about something the user watched
        being saved a moment earlier.
        """
        monkeypatch.setenv("MEMORY_ID", "mem-123")
        mod = load_tool("recall_memories")

        monkeypatch.setattr(mod.agentcore_memory, "long_term_records", lambda *a, **k: [])
        monkeypatch.setattr(
            mod.agentcore_memory,
            "short_term_events",
            lambda *a, **k: [
                {
                    "content": "remember I bank with a joint account",
                    "role": "USER",
                    "timestamp": "2026-01-01T00:00:05Z",
                    "session_id": "s-1",
                }
            ],
        )

        resp = mod.handler(
            {"user_id": "alice", "query": "joint account", "limit": 5},
            self._ctx(lambda_context),
        )

        body = json.loads(resp["content"][0]["text"])
        assert body["count"] == 1
        assert body["memories"][0]["tier"] == "short_term"

    def test_a_user_with_no_memories_gets_an_honest_empty_answer(self, load_tool, lambda_context, monkeypatch):
        """Empty is not broken.

        Treating an empty read as a failure made a brand-new user's recall report
        "No memory backend configured" — untrue, and it sends anyone debugging it
        to the wrong place. The signal for failure has to be that the call raised.
        """
        monkeypatch.setenv("MEMORY_ID", "mem-123")
        mod = load_tool("recall_memories")
        monkeypatch.setattr(mod, "NEPTUNE_ENDPOINT", "")

        monkeypatch.setattr(mod.agentcore_memory, "long_term_records", lambda *a, **k: [])
        monkeypatch.setattr(mod.agentcore_memory, "short_term_events", lambda *a, **k: [])

        resp = mod.handler({"user_id": "alice", "query": "food"}, self._ctx(lambda_context))
        body = json.loads(resp["content"][0]["text"])
        assert body["backend"] == "agentcore"
        assert body["count"] == 0
        assert "status" not in body

    def test_both_tiers_raising_falls_through_instead_of_claiming_none(self, load_tool, lambda_context, monkeypatch):
        """A failed read must not be reported as "you have no memories"."""
        monkeypatch.setenv("MEMORY_ID", "mem-123")
        mod = load_tool("recall_memories")
        monkeypatch.setattr(mod, "NEPTUNE_ENDPOINT", "")

        def boom(*_a, **_k):
            raise RuntimeError("AgentCore down")

        monkeypatch.setattr(mod.agentcore_memory, "long_term_records", boom)
        monkeypatch.setattr(mod.agentcore_memory, "short_term_events", boom)

        resp = mod.handler({"user_id": "alice", "query": "food"}, self._ctx(lambda_context))
        body = json.loads(resp["content"][0]["text"])
        assert body["status"] == "unavailable"
        # The backend exists; saying it is unconfigured would be false.
        assert "could not be read" in body["reason"]

    def test_one_tier_raising_still_returns_the_other(self, load_tool, lambda_context, monkeypatch):
        monkeypatch.setenv("MEMORY_ID", "mem-123")
        mod = load_tool("recall_memories")

        def boom(*_a, **_k):
            raise RuntimeError("long term down")

        monkeypatch.setattr(mod.agentcore_memory, "long_term_records", boom)
        monkeypatch.setattr(
            mod.agentcore_memory,
            "short_term_events",
            lambda *a, **k: [{"content": "joint account please", "role": "USER", "timestamp": "t", "session_id": "s"}],
        )

        resp = mod.handler({"user_id": "alice", "query": "joint"}, self._ctx(lambda_context))
        body = json.loads(resp["content"][0]["text"])
        assert body["count"] == 1
        assert body["memories"][0]["tier"] == "short_term"

    def test_neptune_fallback_uses_parameterized_cypher(self, load_tool, lambda_context, monkeypatch):
        monkeypatch.setenv("MEMORY_ID", "mem-123")
        mod = load_tool("recall_memories")
        monkeypatch.setattr(mod, "NEPTUNE_ENDPOINT", "neptune.example")

        # Both AgentCore tiers must raise, not return empty — an empty read is a
        # legitimate answer and no longer triggers the fallback.
        def boom(*_a, **_k):
            raise RuntimeError("AgentCore down")

        monkeypatch.setattr(mod.agentcore_memory, "long_term_records", boom)
        monkeypatch.setattr(mod.agentcore_memory, "short_term_events", boom)

        captured: list[tuple[str, dict]] = []

        def _fake_neptune(query: str, parameters: dict | None = None):
            captured.append((query, parameters or {}))
            return {"results": [{"memoryId": "m1", "content": "x", "type": "fact", "createdAt": "2026"}]}

        with patch.object(mod, "_execute_neptune_query", _fake_neptune):
            resp = mod.handler(
                {"user_id": "alice", "query": "food", "limit": 5},
                self._ctx(lambda_context),
            )

        body = json.loads(resp["content"][0]["text"])
        assert body["backend"] == "neptune"
        query, params = captured[0]
        # LLM-controlled `query` value must NOT appear in the Cypher text.
        assert "food" not in query
        assert "alice" not in query
        assert params["user_id"] == "alice"
        assert params["query"] == "food"

    def test_missing_user_id_rejected(self, load_tool, lambda_context):
        mod = load_tool("recall_memories")
        resp = mod.handler({"query": "x"}, self._ctx(lambda_context))
        assert "error" in resp and "user_id" in resp["error"]
