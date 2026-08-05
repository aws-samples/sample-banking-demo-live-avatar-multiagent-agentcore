# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
recall_memories — retrieve stored memory records for a user.

Primary backend: AgentCore Memory's `retrieve_memory_records` API, scoped to
the caller's namespaces. Those namespaces are resolved at call time from
GetMemory rather than assumed, because `namespace` is a strict prefix filter
and the strategies are configured under
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


_NAMESPACE_TEMPLATES: list[str] | None = None


def _strategy_namespace_templates(memory_id: str) -> list[str]:
    """Namespace templates of every configured strategy, from GetMemory.

    These cannot be hardcoded. `namespace` on RetrieveMemoryRecords is a strict
    prefix filter — it returns records whose namespace *starts with* the value —
    and the strategies are configured under
    `/strategies/{memoryStrategyId}/actors/{actorId}/...`, where the strategy id
    is generated at deploy time. Asking for `/actors/{user_id}/` therefore
    matched nothing, and the tool reported a healthy empty result forever.

    Cached for the life of the container; strategies change only on redeploy.
    """
    global _NAMESPACE_TEMPLATES
    if _NAMESPACE_TEMPLATES is not None:
        return _NAMESPACE_TEMPLATES

    control = boto3.client("bedrock-agentcore-control")
    strategies = control.get_memory(memoryId=memory_id).get("memory", {}).get("strategies", [])

    templates: list[str] = []
    for strategy in strategies:
        strategy_id = strategy.get("strategyId", "")
        # `namespaces` is the configured form; `namespaceTemplates` is present on
        # newer API versions. Either may still carry {memoryStrategyId}.
        for namespace in strategy.get("namespaces", []) or strategy.get("namespaceTemplates", []) or []:
            templates.append(namespace.replace("{memoryStrategyId}", strategy_id))

    _NAMESPACE_TEMPLATES = templates
    return templates


def _caller_namespace_prefixes(memory_id: str, user_id: str) -> list[str]:
    """Resolve strategy templates into prefixes scoped to this caller.

    Truncates at the first placeholder left after substituting the actor — a
    session-scoped template like `.../actors/{actorId}/sessions/{sessionId}/`
    becomes `.../actors/{user_id}/sessions/`, which is a valid prefix covering
    every session. A literal `{sessionId}` would match nothing.
    """
    prefixes = []
    for template in _strategy_namespace_templates(memory_id):
        resolved = template.replace("{actorId}", user_id)
        placeholder = resolved.find("{")
        if placeholder != -1:
            resolved = resolved[:placeholder]
        if user_id in resolved:
            prefixes.append(resolved)
        else:
            # Never widen the search past the caller: a template without
            # {actorId} would read everyone's memories.
            logger.warning("Skipping namespace template with no actor scope: %s", template)
    return prefixes


def _recall_from_agentcore(user_id: str, memory_id: str, query: str, limit: int) -> str | None:
    """Primary retrieval path via AgentCore Memory.

    Returns a JSON string on success, or None if the call fails or no
    caller-scoped namespace could be resolved (the caller then tries Neptune or
    reports disabled). Returning None rather than an empty result matters: an
    empty list here is indistinguishable from "you have no memories", which is
    how this path stayed broken.
    """
    try:
        prefixes = _caller_namespace_prefixes(memory_id, user_id)
        if not prefixes:
            logger.warning("No caller-scoped namespaces resolved for memory %s", memory_id)
            return None

        agentcore_client = boto3.client("bedrock-agentcore")
        by_id: dict[str, dict] = {}
        for namespace in prefixes:
            response = agentcore_client.retrieve_memory_records(
                memoryId=memory_id,
                namespace=namespace,
                searchCriteria={"searchQuery": query, "topK": limit},
                maxResults=limit,
            )
            # The response key is `memoryRecordSummaries`. Reading `memoryRecords`
            # returned [] on every call regardless of what was stored.
            for record in response.get("memoryRecordSummaries", []):
                by_id[record.get("memoryRecordId", "")] = record

        ranked = sorted(by_id.values(), key=lambda r: r.get("score") or 0, reverse=True)[:limit]
        memories = [
            {
                # `content` is a structure, not a string, and the timestamp field
                # is `createdAt`. Both were mapped wrongly.
                "content": (r.get("content") or {}).get("text", ""),
                "timestamp": str(r.get("createdAt", "")),
                "score": float(r["score"]) if r.get("score") is not None else None,
            }
            for r in ranked
        ]
        return json.dumps(
            {
                "user_id": user_id,
                "query": query,
                "memories": memories,
                "count": len(memories),
                "backend": "agentcore",
            }
        )
    except Exception as e:
        logger.warning("AgentCore Memory retrieval failed: %s", e)
        return None


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
                            "status": "disabled",
                            "reason": "No memory backend configured (neither MEMORY_ID nor NEPTUNE_ENDPOINT)",
                        }
                    ),
                }
            ]
        }

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
