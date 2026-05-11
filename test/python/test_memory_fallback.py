"""Tests for `gateway/tools/save_memory` and `recall_memories` handler fallback.

The Task 6 contract is:
  1. Prefer AgentCore Memory's CreateEvent / retrieve_memory_records when
     MEMORY_ID is set.
  2. Fall back to Neptune with parameterized openCypher when NEPTUNE_ENDPOINT
     is set.
  3. Return `{"status": "disabled"}` — not an error — when neither is set.

Also asserts the Neptune fallback path uses $var bindings, not string
interpolation of LLM-controlled content.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch


class TestSaveMemoryFallbackChain:
    def _ctx(self, lambda_context):
        return lambda_context("save_memory")

    def test_disabled_when_no_backends(self, load_tool, lambda_context, monkeypatch):
        monkeypatch.delenv("MEMORY_ID", raising=False)
        monkeypatch.delenv("NEPTUNE_ENDPOINT", raising=False)
        mod = load_tool("save_memory")
        # reloading the module isn't necessary — NEPTUNE_ENDPOINT is read at
        # module load time, so patch it on the module directly.
        monkeypatch.setattr(mod, "NEPTUNE_ENDPOINT", "")

        resp = mod.handler(
            {"user_id": "alice", "content": "I love spicy food"},
            self._ctx(lambda_context),
        )
        body = json.loads(resp["content"][0]["text"])
        assert body["status"] == "disabled"
        assert body["success"] is False

    def test_prefers_agentcore_when_memory_id_set(self, load_tool, lambda_context, monkeypatch):
        monkeypatch.setenv("MEMORY_ID", "mem-123")
        mod = load_tool("save_memory")
        monkeypatch.setattr(mod, "NEPTUNE_ENDPOINT", "")

        fake_client = MagicMock()
        fake_client.create_event.return_value = {"event": {"eventId": "evt-abc"}}

        with patch.object(mod.boto3, "client", return_value=fake_client):
            resp = mod.handler(
                {"user_id": "alice", "content": "pref", "memory_type": "preference"},
                self._ctx(lambda_context),
            )

        body = json.loads(resp["content"][0]["text"])
        assert body["success"] is True
        assert body["backend"] == "agentcore"
        assert body["memory_id"] == "evt-abc"
        assert fake_client.create_event.called
        call_kwargs = fake_client.create_event.call_args.kwargs
        assert call_kwargs["actorId"] == "alice"
        assert call_kwargs["memoryId"] == "mem-123"

    def test_falls_back_to_neptune_on_agentcore_error(self, load_tool, lambda_context, monkeypatch):
        monkeypatch.setenv("MEMORY_ID", "mem-123")
        mod = load_tool("save_memory")
        monkeypatch.setattr(mod, "NEPTUNE_ENDPOINT", "neptune.example")

        fake_client = MagicMock()
        fake_client.create_event.side_effect = RuntimeError("Memory service down")

        captured_cypher: list[tuple[str, dict]] = []

        def _fake_neptune(query: str, parameters: dict | None = None):
            captured_cypher.append((query, parameters or {}))
            return {"results": []}

        with (
            patch.object(mod.boto3, "client", return_value=fake_client),
            patch.object(mod, "_execute_neptune_query", _fake_neptune),
        ):
            resp = mod.handler(
                {"user_id": "alice", "content": "note"},
                self._ctx(lambda_context),
            )

        body = json.loads(resp["content"][0]["text"])
        assert body["success"] is True
        assert body["backend"] == "neptune"
        # Parameterized Cypher — content must NOT appear in the query text.
        assert len(captured_cypher) == 1
        query, params = captured_cypher[0]
        assert "note" not in query
        assert "alice" not in query
        assert params["user_id"] == "alice"
        assert params["content"] == "note"

    def test_missing_user_id_rejected(self, load_tool, lambda_context):
        mod = load_tool("save_memory")
        resp = mod.handler({"content": "x"}, self._ctx(lambda_context))
        assert "error" in resp and "user_id" in resp["error"]

    def test_missing_content_rejected(self, load_tool, lambda_context):
        mod = load_tool("save_memory")
        resp = mod.handler({"user_id": "alice"}, self._ctx(lambda_context))
        assert "error" in resp and "content" in resp["error"]


class TestRecallMemoriesFallbackChain:
    def _ctx(self, lambda_context):
        return lambda_context("recall_memories")

    def test_disabled_when_no_backends(self, load_tool, lambda_context, monkeypatch):
        monkeypatch.delenv("MEMORY_ID", raising=False)
        mod = load_tool("recall_memories")
        monkeypatch.setattr(mod, "NEPTUNE_ENDPOINT", "")

        resp = mod.handler({"user_id": "alice", "query": "food"}, self._ctx(lambda_context))
        body = json.loads(resp["content"][0]["text"])
        assert body["status"] == "disabled"
        assert body["memories"] == []

    def test_agentcore_success_uses_actor_namespace(self, load_tool, lambda_context, monkeypatch):
        monkeypatch.setenv("MEMORY_ID", "mem-123")
        mod = load_tool("recall_memories")

        fake_client = MagicMock()
        fake_client.retrieve_memory_records.return_value = {
            "memoryRecords": [
                {"content": "user likes spicy", "timestamp": "2026-01-01T00:00:00Z"},
            ]
        }
        with patch.object(mod.boto3, "client", return_value=fake_client):
            resp = mod.handler(
                {"user_id": "alice", "query": "food", "limit": 5},
                self._ctx(lambda_context),
            )

        body = json.loads(resp["content"][0]["text"])
        assert body["backend"] == "agentcore"
        assert body["count"] == 1
        # Critical: namespace is /actors/{user_id}/ — strategy-ID-free.
        kwargs = fake_client.retrieve_memory_records.call_args.kwargs
        assert kwargs["namespace"] == "/actors/alice/"
        assert kwargs["memoryId"] == "mem-123"

    def test_neptune_fallback_uses_parameterized_cypher(self, load_tool, lambda_context, monkeypatch):
        monkeypatch.setenv("MEMORY_ID", "mem-123")
        mod = load_tool("recall_memories")
        monkeypatch.setattr(mod, "NEPTUNE_ENDPOINT", "neptune.example")

        # Make AgentCore fail so we fall through.
        fake_client = MagicMock()
        fake_client.retrieve_memory_records.side_effect = RuntimeError("AgentCore down")

        captured: list[tuple[str, dict]] = []

        def _fake_neptune(query: str, parameters: dict | None = None):
            captured.append((query, parameters or {}))
            return {"results": [{"memoryId": "m1", "content": "x", "type": "fact", "createdAt": "2026"}]}

        with (
            patch.object(mod.boto3, "client", return_value=fake_client),
            patch.object(mod, "_execute_neptune_query", _fake_neptune),
        ):
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
