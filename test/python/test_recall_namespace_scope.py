# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""The memory layer must ask for namespaces the strategies actually write to.

`namespace` on RetrieveMemoryRecords and ListMemoryRecords is a strict prefix
filter, and the strategies in lib/stacks/backend/index.ts are configured under
`/strategies/{memoryStrategyId}/actors/{actorId}/...`. The tool asked for
`/actors/{user_id}/`, which is not a prefix of that. It then read `memoryRecords`
from a response whose key is `memoryRecordSummaries`, and mapped `timestamp` and
a plain-string `content` where the API returns `createdAt` and `{"text": ...}`.
Any one of those alone guaranteed zero results, and it reported
`backend: agentcore, count: 0` — indistinguishable from a user with no memories.

Field names asserted here come from the botocore service model, not from prose.
"""

import agentcore_memory
import pytest

USER = "cognito-sub-1234"
MEMORY_ID = "mem-abc123456789"
STRATEGY_ID = "generated-strategy-id"

# Mirrors the templates configured in lib/stacks/backend/index.ts.
CONFIGURED_NAMESPACES = [
    "/strategies/{memoryStrategyId}/actors/{actorId}/sessions/{sessionId}/",
    "/strategies/{memoryStrategyId}/actors/{actorId}/",
]


class FakeControl:
    def __init__(self, namespaces):
        self._namespaces = namespaces

    def get_memory(self, **_):
        return {"memory": {"strategies": [{"strategyId": STRATEGY_ID, "namespaces": self._namespaces}]}}


class FakeData:
    def __init__(self, records=None, sessions=None, events=None):
        self._records = records or []
        self._sessions = sessions or []
        self._events = events or []
        self.retrieve_calls: list[dict] = []
        self.list_record_calls: list[dict] = []
        self.list_event_calls: list[dict] = []

    def retrieve_memory_records(self, **kwargs):
        self.retrieve_calls.append(kwargs)
        return {"memoryRecordSummaries": self._records}

    def list_memory_records(self, **kwargs):
        self.list_record_calls.append(kwargs)
        return {"memoryRecordSummaries": self._records}

    def list_sessions(self, **_):
        return {"sessionSummaries": self._sessions}

    def list_events(self, **kwargs):
        self.list_event_calls.append(kwargs)
        return {"events": self._events}


@pytest.fixture
def memory(monkeypatch):
    """Fresh layer module with the cache cleared and clients stubbed."""
    agentcore_memory.reset_cache()

    state = {"control": FakeControl(CONFIGURED_NAMESPACES), "data": FakeData()}
    monkeypatch.setattr(agentcore_memory, "_control_client", lambda: state["control"])
    monkeypatch.setattr(agentcore_memory, "_data_client", lambda: state["data"])
    return state


def test_resolves_the_generated_strategy_id_into_the_namespace(memory):
    prefixes = agentcore_memory.caller_namespace_prefixes(MEMORY_ID, USER)

    assert f"/strategies/{STRATEGY_ID}/actors/{USER}/" in prefixes
    # The session-scoped template becomes a prefix; a literal {sessionId} matches nothing.
    assert f"/strategies/{STRATEGY_ID}/actors/{USER}/sessions/" in prefixes
    assert not any("{" in prefix for prefix in prefixes)


def test_never_asks_for_the_namespace_that_matches_nothing(memory):
    """The old prefix. Kept as an explicit guard against reintroducing it."""
    prefixes = agentcore_memory.caller_namespace_prefixes(MEMORY_ID, USER)

    assert f"/actors/{USER}/" not in prefixes


def test_refuses_a_namespace_that_is_not_scoped_to_the_caller(memory):
    """A template without {actorId} would read every user's memories."""
    memory["control"] = FakeControl(["/strategies/{memoryStrategyId}/shared/"])
    agentcore_memory.reset_cache()

    assert agentcore_memory.caller_namespace_prefixes(MEMORY_ID, USER) == []
    assert agentcore_memory.long_term_records(MEMORY_ID, USER, query="q") == []
    assert memory["data"].retrieve_calls == []


def test_resolution_is_cached_per_container(memory):
    calls = []
    original = memory["control"].get_memory

    def counting(**kwargs):
        calls.append(kwargs)
        return original(**kwargs)

    memory["control"].get_memory = counting

    agentcore_memory.caller_namespace_prefixes(MEMORY_ID, USER)
    agentcore_memory.caller_namespace_prefixes(MEMORY_ID, USER)

    assert len(calls) == 1


class TestLongTermRecords:
    def test_reads_the_real_response_key_and_fields(self, memory):
        memory["data"] = FakeData(
            records=[
                {
                    "memoryRecordId": "rec-1",
                    "content": {"text": "Prefers paperless statements"},
                    "createdAt": "2026-08-05T09:28:00+00:00",
                    "memoryStrategyId": STRATEGY_ID,
                    "score": 0.82,
                }
            ]
        )

        records = agentcore_memory.long_term_records(MEMORY_ID, USER, query="statements")

        assert len(records) == 1
        assert records[0]["content"] == "Prefers paperless statements"
        assert records[0]["timestamp"] == "2026-08-05T09:28:00+00:00"
        assert records[0]["strategy_id"] == STRATEGY_ID

    def test_deduplicates_records_seen_under_overlapping_prefixes(self, memory):
        """The two configured templates overlap, so one record comes back twice."""
        memory["data"] = FakeData(
            records=[{"memoryRecordId": "rec-1", "content": {"text": "one"}, "createdAt": "t", "score": 0.5}]
        )

        assert len(agentcore_memory.long_term_records(MEMORY_ID, USER, query="q")) == 1

    def test_searches_with_a_query_and_lists_without_one(self, memory):
        """Pattern analysis has no search term, so it must not require one."""
        data = FakeData(records=[])
        memory["data"] = data

        agentcore_memory.long_term_records(MEMORY_ID, USER, query="statements")
        assert data.retrieve_calls and not data.list_record_calls

        data.retrieve_calls.clear()
        agentcore_memory.long_term_records(MEMORY_ID, USER)
        assert data.list_record_calls and not data.retrieve_calls
        # Listing must still be scoped — omitting namespace would read everyone.
        assert all(USER in call["namespace"] for call in data.list_record_calls)


class TestShortTermEvents:
    def test_lists_events_per_session_because_the_api_requires_one(self, memory):
        memory["data"] = FakeData(
            sessions=[{"sessionId": "s-1", "createdAt": "t0"}, {"sessionId": "s-2", "createdAt": "t1"}],
            events=[
                {
                    "eventId": "e-1",
                    "sessionId": "s-1",
                    "eventTimestamp": "2026-08-05T09:30:00+00:00",
                    "payload": [{"conversational": {"role": "ASSISTANT", "content": {"text": "noted"}}}],
                }
            ],
        )

        events = agentcore_memory.short_term_events(MEMORY_ID, USER)

        sessions_queried = [call["sessionId"] for call in memory["data"].list_event_calls]
        assert sessions_queried == ["s-1", "s-2"]
        assert all(call["actorId"] == USER for call in memory["data"].list_event_calls)
        assert events[0]["content"] == "noted"
        assert events[0]["role"] == "ASSISTANT"

    def test_skips_payload_items_with_no_text(self, memory):
        memory["data"] = FakeData(
            sessions=[{"sessionId": "s-1", "createdAt": "t0"}],
            events=[{"eventId": "e-1", "sessionId": "s-1", "eventTimestamp": "t", "payload": [{"blob": {}}]}],
        )

        assert agentcore_memory.short_term_events(MEMORY_ID, USER) == []

    def test_no_sessions_yields_no_events(self, memory):
        memory["data"] = FakeData(sessions=[])

        assert agentcore_memory.short_term_events(MEMORY_ID, USER) == []


def test_api_shape_matches_what_the_layer_reads():
    """Pin the field names against the botocore model, not against prose.

    The handler previously read `memoryRecords`, `timestamp`, and a string
    `content`. None of those exist. Stubs alone cannot catch that — a stub returns
    whatever the test author believed — so assert the real service model.
    """
    import boto3

    model = boto3.Session()._session.get_service_model("bedrock-agentcore")

    retrieve = model.operation_model("RetrieveMemoryRecords")
    assert "namespace" in retrieve.input_shape.members
    assert "memoryRecordSummaries" in retrieve.output_shape.members
    assert "memoryRecords" not in retrieve.output_shape.members

    record = retrieve.output_shape.members["memoryRecordSummaries"].member
    assert {"content", "createdAt", "memoryRecordId", "memoryStrategyId", "score"} <= set(record.members)
    assert "timestamp" not in record.members
    assert "text" in record.members["content"].members

    listing = model.operation_model("ListMemoryRecords")
    assert "searchCriteria" not in listing.input_shape.members
    assert "memoryRecordSummaries" in listing.output_shape.members

    # ListEvents requires a sessionId, which is why sessions are enumerated first.
    events = model.operation_model("ListEvents")
    assert "sessionId" in events.input_shape.required_members
    assert "sessionSummaries" in model.operation_model("ListSessions").output_shape.members

    control = boto3.Session()._session.get_service_model("bedrock-agentcore-control")
    strategy = control.operation_model("GetMemory").output_shape.members["memory"].members["strategies"].member
    assert {"strategyId", "namespaces"} <= set(strategy.members)
