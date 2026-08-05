# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""recall_memories must ask for a namespace the strategies actually write to.

`namespace` on RetrieveMemoryRecords is a strict prefix filter, and the
strategies in lib/stacks/backend/index.ts are configured under
`/strategies/{memoryStrategyId}/actors/{actorId}/...`. The tool asked for
`/actors/{user_id}/`, which is not a prefix of that, so it matched nothing. It
then read `memoryRecords` from a response whose key is `memoryRecordSummaries`,
and mapped `timestamp` and a plain-string `content` where the API returns
`createdAt` and `{"text": ...}`. Any one of those alone guaranteed zero results,
and the tool reported `backend: agentcore, count: 0` — indistinguishable from a
user who has no memories.

The API shapes asserted here come from the botocore service model, not from prose.
"""

import importlib
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

GATEWAY_TOOLS = Path(__file__).resolve().parents[2] / "gateway" / "tools"

USER = "cognito-sub-1234"
MEMORY_ID = "mem-abc123456789"
STRATEGY_ID = "generated-strategy-id"

# Mirrors the templates configured in lib/stacks/backend/index.ts.
CONFIGURED_NAMESPACES = [
    "/strategies/{memoryStrategyId}/actors/{actorId}/sessions/{sessionId}/",
    "/strategies/{memoryStrategyId}/actors/{actorId}/",
]


@pytest.fixture
def recall():
    sys.path.insert(0, str(GATEWAY_TOOLS / "recall_memories"))
    sys.modules.pop("handler", None)
    try:
        module = importlib.import_module("handler")
    finally:
        sys.path.pop(0)
    module._NAMESPACE_TEMPLATES = None  # cache is process-wide
    return module


def _stub_clients(module, records, namespaces=None):
    """Stub the control-plane GetMemory and data-plane retrieve calls."""
    control = MagicMock()
    control.get_memory.return_value = {
        "memory": {
            "strategies": [
                {
                    "strategyId": STRATEGY_ID,
                    "namespaces": namespaces if namespaces is not None else CONFIGURED_NAMESPACES,
                }
            ]
        }
    }
    data = MagicMock()
    data.retrieve_memory_records.return_value = {"memoryRecordSummaries": records}

    module.boto3 = MagicMock()
    module.boto3.client.side_effect = lambda name, **_: control if name.endswith("-control") else data
    return control, data


def test_resolves_the_generated_strategy_id_into_the_namespace(recall):
    _, data = _stub_clients(recall, [])

    recall._recall_from_agentcore(USER, MEMORY_ID, "checking account", 5)

    asked = [call.kwargs["namespace"] for call in data.retrieve_memory_records.call_args_list]
    assert f"/strategies/{STRATEGY_ID}/actors/{USER}/" in asked
    # The session-scoped template becomes a prefix; a literal {sessionId} matches nothing.
    assert f"/strategies/{STRATEGY_ID}/actors/{USER}/sessions/" in asked
    assert not any("{" in namespace for namespace in asked)


def test_never_asks_for_the_namespace_that_matches_nothing(recall):
    """The old prefix. Kept as an explicit guard against reintroducing it."""
    _, data = _stub_clients(recall, [])

    recall._recall_from_agentcore(USER, MEMORY_ID, "q", 5)

    asked = [call.kwargs["namespace"] for call in data.retrieve_memory_records.call_args_list]
    assert f"/actors/{USER}/" not in asked


def test_reads_the_real_response_key_and_fields(recall):
    _stub_clients(
        recall,
        [
            {
                "memoryRecordId": "rec-1",
                "content": {"text": "Prefers paperless statements"},
                "createdAt": "2026-08-05T09:28:00+00:00",
                "score": 0.82,
            }
        ],
    )

    result = json.loads(recall._recall_from_agentcore(USER, MEMORY_ID, "statements", 5))

    assert result["count"] == 1
    memory = result["memories"][0]
    assert memory["content"] == "Prefers paperless statements"
    assert memory["timestamp"] == "2026-08-05T09:28:00+00:00"
    assert result["backend"] == "agentcore"


def test_deduplicates_records_seen_under_overlapping_prefixes(recall):
    """The two configured templates overlap, so one record can come back twice."""
    _stub_clients(
        recall,
        [{"memoryRecordId": "rec-1", "content": {"text": "one"}, "createdAt": "t", "score": 0.5}],
    )

    result = json.loads(recall._recall_from_agentcore(USER, MEMORY_ID, "q", 5))

    assert result["count"] == 1


def test_falls_back_rather_than_reporting_an_empty_success(recall):
    """No caller-scoped namespace resolved is a failure, not "no memories"."""
    _stub_clients(recall, [], namespaces=[])

    assert recall._recall_from_agentcore(USER, MEMORY_ID, "q", 5) is None


def test_refuses_a_namespace_that_is_not_scoped_to_the_caller(recall):
    """A template without {actorId} would read every user's memories."""
    _, data = _stub_clients(recall, [], namespaces=["/strategies/{memoryStrategyId}/shared/"])

    assert recall._recall_from_agentcore(USER, MEMORY_ID, "q", 5) is None
    data.retrieve_memory_records.assert_not_called()


def test_api_shape_matches_what_the_handler_reads():
    """Pin the field names against the botocore model, not against prose.

    The handler previously read `memoryRecords`, `timestamp`, and a string
    `content`. None of those exist. Stubs alone cannot catch that — a stub
    returns whatever the test author believed — so assert the real service model.
    """
    import boto3

    model = boto3.Session()._session.get_service_model("bedrock-agentcore")
    retrieve = model.operation_model("RetrieveMemoryRecords")

    assert "namespace" in retrieve.input_shape.members
    assert "memoryRecordSummaries" in retrieve.output_shape.members
    assert "memoryRecords" not in retrieve.output_shape.members

    record = retrieve.output_shape.members["memoryRecordSummaries"].member
    assert {"content", "createdAt", "memoryRecordId", "score"} <= set(record.members)
    assert "timestamp" not in record.members
    assert "text" in record.members["content"].members

    control = boto3.Session()._session.get_service_model("bedrock-agentcore-control")
    strategy = control.operation_model("GetMemory").output_shape.members["memory"].members["strategies"].member
    assert {"strategyId", "namespaces"} <= set(strategy.members)
