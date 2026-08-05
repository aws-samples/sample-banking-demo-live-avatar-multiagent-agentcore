# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
recall_memories — retrieve stored memory records for a user.

Primary backend: AgentCore Memory, read across both tiers via the shared
`agentcore_memory` layer — long-term extracted records plus short-term events,
since extraction is asynchronous and a just-saved memory exists only as an event.
Namespaces are resolved at call time from GetMemory rather than assumed, because
`namespace` is a strict prefix filter and the strategies are configured under
`/strategies/{memoryStrategyId}/actors/{actorId}/...`. There is no shared
`/actors/{user_id}/` namespace to read from — that prefix matches nothing.

Fallback backend: Neptune Analytics graph (only when `NEPTUNE_ENDPOINT` env
var is set). The fallback uses parameterized openCypher queries — no string
interpolation — so LLM-controlled `content` values can't inject Cypher.

When neither backend is configured, returns a structured `{"status": "disabled"}`
result rather than an error, so chatbot turns stay graceful.
"""

import json
import logging
import os
import urllib.parse
import urllib.request

import agentcore_memory
import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

logger = logging.getLogger()
logger.setLevel(logging.INFO)

NEPTUNE_ENDPOINT = os.environ.get("NEPTUNE_ENDPOINT", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

session = boto3.Session()


def _sign_request(method: str, url: str, body: str = "") -> dict:
    """Sign a request for Neptune IAM authentication."""
    credentials = session.get_credentials().get_frozen_credentials()
    request = AWSRequest(
        method=method,
        url=url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    SigV4Auth(credentials, "neptune-db", AWS_REGION).add_auth(request)
    return dict(request.headers)


def _execute_neptune_query(query: str, parameters: dict | None = None) -> dict:
    """Execute a parameterized openCypher query against Neptune Analytics.

    Uses Neptune's `parameters` form-field for bound variables rather than
    string interpolation — prevents Cypher injection from LLM-controlled
    content values.
    """
    url = f"https://{NEPTUNE_ENDPOINT}/queries"
    form_fields = {
        "query": query,
        "lang": "opencypher",
    }
    if parameters:
        form_fields["parameters"] = json.dumps(parameters)
    body = urllib.parse.urlencode(form_fields)

    headers = _sign_request("POST", url, body)
    headers["Content-Type"] = "application/x-www-form-urlencoded"

    req = urllib.request.Request(url, data=body.encode("utf-8"), headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=300) as response:  # nosec B310 — https://{NEPTUNE_ENDPOINT}/queries, host from CDK env var
            return json.loads(response.read().decode("utf-8"))
    except Exception as e:
        logger.error(f"Neptune query failed: {e}")
        raise


def _recall_from_neptune(user_id: str, query: str, limit: int) -> str:
    """Fallback retrieval path via Neptune graph.

    Uses parameterized Cypher ($user_id, $query, $limit) — never string
    interpolation of LLM content.
    """
    # The openCypher spec forbids parameters for LIMIT, so we cast and embed
    # safely (int() guards against injection).
    safe_limit = int(limit)

    if query:
        cypher = (
            "MATCH (u:User {userId: $user_id})-[:HAS_MEMORY]->(m:Memory) "
            "WHERE m.content CONTAINS $query "
            "RETURN m.memoryId AS memoryId, m.content AS content, "
            "m.type AS type, m.createdAt AS createdAt "
            f"ORDER BY m.createdAt DESC LIMIT {safe_limit}"
        )
        params = {"user_id": user_id, "query": query}
    else:
        cypher = (
            "MATCH (u:User {userId: $user_id})-[:HAS_MEMORY]->(m:Memory) "
            "RETURN m.memoryId AS memoryId, m.content AS content, "
            "m.type AS type, m.createdAt AS createdAt "
            f"ORDER BY m.createdAt DESC LIMIT {safe_limit}"
        )
        params = {"user_id": user_id}

    result = _execute_neptune_query(cypher, params)

    memories = []
    for row in result.get("results", []):
        memories.append(
            {
                "memory_id": row.get("memoryId", ""),
                "content": row.get("content", ""),
                "type": row.get("type", "fact"),
                "created_at": row.get("createdAt", ""),
            }
        )

    return json.dumps(
        {
            "user_id": user_id,
            "query": query,
            "memories": memories,
            "count": len(memories),
            "backend": "neptune",
        }
    )


def _recall_from_agentcore(user_id: str, memory_id: str, query: str, limit: int) -> str | None:
    """Primary retrieval path via AgentCore Memory, across both tiers.

    Long-term records carry what the strategies extracted. Short-term events are
    consulted as well because extraction is asynchronous: for the first stretch
    after `save_memory`, the event is the only record that exists, so a
    long-term-only reader answers "nothing" about a memory the user just watched
    being saved.

    Returns a JSON string when either tier could be read — including an empty
    list, which is the honest answer for a user who has saved nothing. Returns
    None only when both reads actually failed, so the caller can fall back
    instead of asserting anything about the user's memories.

    The distinction has to come from whether the call raised, not from whether
    the result was empty. Treating "empty" as "broken" made a brand-new user's
    recall report "No memory backend configured", which was simply untrue.
    """
    long_term_ok = True
    try:
        long_term = agentcore_memory.long_term_records(memory_id, user_id, query=query, limit=limit)
    except Exception as e:
        logger.warning("AgentCore long-term retrieval failed: %s", e)
        long_term, long_term_ok = [], False

    short_term_ok = True
    try:
        short_term = agentcore_memory.short_term_events(memory_id, user_id)
    except Exception as e:
        logger.warning("AgentCore short-term retrieval failed: %s", e)
        short_term, short_term_ok = [], False

    if not long_term_ok and not short_term_ok:
        return None

    if query:
        # Long term is already ranked semantically; short term is not searchable,
        # so filter it literally rather than implying a relevance it doesn't have.
        needle = query.lower()
        short_term = [e for e in short_term if needle in e["content"].lower()]

    memories = [
        {"content": r["content"], "timestamp": r["timestamp"], "score": r["score"], "tier": "long_term"}
        for r in long_term
    ]
    seen = {m["content"] for m in memories}
    for e in short_term[:limit]:
        if e["content"] in seen:
            continue
        memories.append(
            {
                "content": e["content"],
                "timestamp": e["timestamp"],
                "score": None,
                "tier": "short_term",
            }
        )

    return json.dumps(
        {
            "user_id": user_id,
            "query": query,
            "memories": memories[:limit],
            "count": len(memories[:limit]),
            "backend": "agentcore",
        }
    )


def handler(event, context):
    """
    Recall memories tool Lambda handler.

    Tries AgentCore Memory first; falls back to Neptune if unavailable;
    returns `{"status": "disabled"}` if neither is configured.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name != "recall_memories":
            return {"error": f"This Lambda only supports 'recall_memories', received: {tool_name}"}

        user_id = event.get("user_id", "")
        query = event.get("query", "")
        limit = event.get("limit", 10)

        if not user_id:
            return {"error": "Missing required parameter: user_id"}

        memory_id = os.environ.get("MEMORY_ID", "")

        # 1. Primary: AgentCore Memory
        if memory_id:
            agentcore_result = _recall_from_agentcore(user_id, memory_id, query, limit)
            if agentcore_result is not None:
                return {"content": [{"type": "text", "text": agentcore_result}]}

        # 2. Fallback: Neptune graph
        if NEPTUNE_ENDPOINT:
            result = _recall_from_neptune(user_id, query, limit)
            return {"content": [{"type": "text", "text": result}]}

        # 3. Neither available — graceful disable.
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {
                            "user_id": user_id,
                            "query": query,
                            "memories": [],
                            "count": 0,
                            "status": "unavailable",
                            # Distinguish the two ways of getting here. Reporting
                            # "not configured" when a configured backend simply
                            # failed to read sends anyone debugging it to the
                            # wrong place, and tells the user something untrue.
                            "reason": (
                                "No memory backend configured (neither MEMORY_ID nor NEPTUNE_ENDPOINT)"
                                if not memory_id
                                else "Memory backend is configured but could not be read"
                            ),
                        }
                    ),
                }
            ]
        }

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
