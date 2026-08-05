# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Shared AgentCore Memory access for gateway tool Lambdas.

Delivered as a Lambda layer because `recall_memories` and `analyze_patterns`
must resolve namespaces identically. Each tool bundles from its own directory,
so without a layer the only options were a second copy or a cross-Lambda call.
A copy is the worse failure: the namespace logic here was already wrong once in
a way that produced empty results rather than errors, and two copies drifting
would disable retrieval on one path with nothing to say so.

Two tiers, and the distinction matters:

* Short term — raw events written by CreateEvent, readable immediately. Scoped by
  actorId + sessionId.
* Long term — records that strategies extract from those events *asynchronously*.
  Scoped by namespace.

Because extraction is asynchronous, anything saved seconds ago exists only in
short term. A reader that consults long term alone reports nothing for a memory
the user just watched being saved.
"""

import logging
import os

import boto3

logger = logging.getLogger(__name__)

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# Resolved once per container; strategies change only on redeploy.
_NAMESPACE_TEMPLATES: list[str] | None = None


def reset_cache() -> None:
    """Drop the resolved-namespace cache. For tests."""
    global _NAMESPACE_TEMPLATES
    _NAMESPACE_TEMPLATES = None


def _control_client():
    return boto3.client("bedrock-agentcore-control", region_name=AWS_REGION)


def _data_client():
    return boto3.client("bedrock-agentcore", region_name=AWS_REGION)


def strategy_namespace_templates(memory_id: str) -> list[str]:
    """Namespace templates of every configured strategy, from GetMemory.

    These cannot be hardcoded. `namespace` on RetrieveMemoryRecords and
    ListMemoryRecords is a strict prefix filter — it matches namespaces that
    *start with* the value — and the strategies are configured under
    `/strategies/{memoryStrategyId}/actors/{actorId}/...` with an id generated at
    deploy time. A hardcoded `/actors/{user_id}/` is not a prefix of that and
    matched nothing.
    """
    global _NAMESPACE_TEMPLATES
    if _NAMESPACE_TEMPLATES is not None:
        return _NAMESPACE_TEMPLATES

    strategies = _control_client().get_memory(memoryId=memory_id).get("memory", {}).get("strategies", [])

    templates: list[str] = []
    for strategy in strategies:
        strategy_id = strategy.get("strategyId", "")
        # `namespaces` is the configured form; `namespaceTemplates` appears on
        # newer API versions. Either may still carry {memoryStrategyId}.
        configured = strategy.get("namespaces") or strategy.get("namespaceTemplates") or []
        for namespace in configured:
            templates.append(namespace.replace("{memoryStrategyId}", strategy_id))

    _NAMESPACE_TEMPLATES = templates
    return templates


def caller_namespace_prefixes(memory_id: str, user_id: str) -> list[str]:
    """Resolve strategy templates into prefixes scoped to this caller.

    Truncates at the first placeholder remaining after the actor is substituted:
    `.../actors/{actorId}/sessions/{sessionId}/` becomes
    `.../actors/{user_id}/sessions/`, a valid prefix spanning every session. A
    literal `{sessionId}` would match nothing.

    A template without `{actorId}` is dropped rather than queried, since it would
    read every user's memories.
    """
    prefixes = []
    for template in strategy_namespace_templates(memory_id):
        resolved = template.replace("{actorId}", user_id)
        placeholder = resolved.find("{")
        if placeholder != -1:
            resolved = resolved[:placeholder]
        if user_id in resolved:
            prefixes.append(resolved)
        else:
            logger.warning("Skipping namespace template with no actor scope: %s", template)
    return prefixes


def long_term_records(memory_id: str, user_id: str, query: str = "", limit: int = 20) -> list[dict]:
    """Extracted memory records for this caller, newest-relevant first.

    With a `query`, searches semantically via RetrieveMemoryRecords. Without one,
    lists everything under the caller's namespaces via ListMemoryRecords — the
    right call for pattern analysis, which has no search term.

    Deduplicated because the configured templates overlap: a session-scoped and
    an actor-scoped prefix can both cover the same record.
    """
    prefixes = caller_namespace_prefixes(memory_id, user_id)
    if not prefixes:
        logger.warning("No caller-scoped namespaces resolved for memory %s", memory_id)
        return []

    client = _data_client()
    by_id: dict[str, dict] = {}
    for namespace in prefixes:
        try:
            if query:
                response = client.retrieve_memory_records(
                    memoryId=memory_id,
                    namespace=namespace,
                    searchCriteria={"searchQuery": query, "topK": limit},
                    maxResults=limit,
                )
            else:
                response = client.list_memory_records(
                    memoryId=memory_id,
                    namespace=namespace,
                    maxResults=limit,
                )
        except Exception as e:
            logger.warning("Long-term read failed for %s: %s", namespace, e)
            continue

        # The response key is `memoryRecordSummaries` on both operations.
        for record in response.get("memoryRecordSummaries", []):
            by_id[record.get("memoryRecordId", "")] = record

    ranked = sorted(by_id.values(), key=lambda r: r.get("score") or 0, reverse=True)
    return [
        {
            # `content` is a structure with `text`, and the timestamp field is
            # `createdAt`. Both are easy to get wrong and neither errors.
            "content": (r.get("content") or {}).get("text", ""),
            "timestamp": str(r.get("createdAt", "")),
            "strategy_id": r.get("memoryStrategyId", ""),
            "score": float(r["score"]) if r.get("score") is not None else None,
        }
        for r in ranked[:limit]
    ]


def sessions(memory_id: str, user_id: str, limit: int = 20) -> list[dict]:
    """This caller's conversation sessions, from short-term memory."""
    try:
        response = _data_client().list_sessions(memoryId=memory_id, actorId=user_id, maxResults=limit)
    except Exception as e:
        logger.warning("Could not list sessions for %s: %s", user_id, e)
        return []

    return [
        {"session_id": s.get("sessionId", ""), "created_at": str(s.get("createdAt", ""))}
        for s in response.get("sessionSummaries", [])
    ]


def short_term_events(
    memory_id: str,
    user_id: str,
    max_sessions: int = 5,
    per_session: int = 20,
) -> list[dict]:
    """Recent raw events for this caller, newest session first.

    ListEvents requires a sessionId, so the caller's sessions are listed first.
    Bounded by `max_sessions` to keep a tool call within its timeout.

    This is what makes a just-saved memory findable: long-term extraction is
    asynchronous, so for the first stretch after a save the event is the only
    record that exists.
    """
    client = _data_client()
    events: list[dict] = []

    for session in sessions(memory_id, user_id, limit=max_sessions):
        try:
            response = client.list_events(
                memoryId=memory_id,
                actorId=user_id,
                sessionId=session["session_id"],
                includePayloads=True,
                maxResults=per_session,
            )
        except Exception as e:
            logger.warning("Could not list events for session %s: %s", session["session_id"], e)
            continue

        for event in response.get("events", []):
            for item in event.get("payload", []) or []:
                conversational = item.get("conversational") or {}
                text = (conversational.get("content") or {}).get("text", "")
                if not text:
                    continue
                events.append(
                    {
                        "content": text,
                        "role": conversational.get("role", ""),
                        "timestamp": str(event.get("eventTimestamp", "")),
                        "session_id": event.get("sessionId", ""),
                    }
                )

    events.sort(key=lambda e: e["timestamp"], reverse=True)
    return events
