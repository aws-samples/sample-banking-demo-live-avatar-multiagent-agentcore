# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
analyze_patterns — summarise a user's conversation history from AgentCore Memory.

Reads both tiers, because they answer different halves of the question:

* Short term (events) — how much the user has talked, across how many sessions,
  and when. Available immediately after each turn.
* Long term (records) — what the strategies actually extracted, grouped by
  strategy. Populated asynchronously, so it lags the conversation.

Previously this queried a Neptune Analytics graph. That graph was only ever
written by a now-removed memory fallback path, and `neptune` is false in
cdk.json, so the endpoint was never configured and every call returned
"NEPTUNE_ENDPOINT environment variable not configured" — a registered tool that
could not work, surfacing an infrastructure error mid-conversation. The Neptune
path is removed rather than kept dormant; it also interpolated `user_id` straight
into openCypher, unlike its parameterized siblings.

Reports honestly when a user has no history yet: an empty summary with a note,
not an error, so a chatbot turn stays graceful.
"""

import json
import logging
import os

import agentcore_memory

logger = logging.getLogger()
logger.setLevel(logging.INFO)

MEMORY_ID = os.environ.get("MEMORY_ID", "")

# Enough to characterise usage without risking the tool's timeout.
MAX_SESSIONS = 10
EVENTS_PER_SESSION = 50
PREVIEW = 5
CONTENT_PREVIEW_CHARS = 200


def _analyze(user_id: str, memory_id: str) -> dict:
    """Summarise short-term activity and long-term extraction for one caller."""
    events = agentcore_memory.short_term_events(
        memory_id,
        user_id,
        max_sessions=MAX_SESSIONS,
        per_session=EVENTS_PER_SESSION,
    )
    records = agentcore_memory.long_term_records(memory_id, user_id, limit=100)

    timestamps = sorted(e["timestamp"] for e in events if e["timestamp"])
    session_ids = {e["session_id"] for e in events if e["session_id"]}

    by_strategy: dict[str, int] = {}
    for record in records:
        key = record["strategy_id"] or "unattributed"
        by_strategy[key] = by_strategy.get(key, 0) + 1

    analysis = {
        "user_id": user_id,
        "short_term": {
            "sessions": len(session_ids),
            "exchanges": len(events),
            "first_activity": timestamps[0] if timestamps else "",
            "last_activity": timestamps[-1] if timestamps else "",
            "recent": [
                {
                    "content": e["content"][:CONTENT_PREVIEW_CHARS],
                    "role": e["role"],
                    "timestamp": e["timestamp"],
                }
                for e in events[:PREVIEW]
            ],
        },
        "long_term": {
            "records": len(records),
            "by_strategy": by_strategy,
            "extracted": [
                {"content": r["content"][:CONTENT_PREVIEW_CHARS], "timestamp": r["timestamp"]}
                for r in records[:PREVIEW]
            ],
        },
    }

    if not events and not records:
        analysis["note"] = "No conversation history recorded for this user yet."
    elif events and not records:
        # Worth stating rather than letting it read as "nothing was remembered":
        # extraction runs asynchronously, so this is the expected state early in
        # a session.
        analysis["note"] = "Conversation events are recorded; long-term extraction has not produced records yet."

    return analysis


def handler(event, context):
    """
    Conversation pattern analysis tool Lambda handler.

    Summarises the caller's AgentCore Memory across short-term events and
    long-term extracted records.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name in ("analyze_patterns", "analyze_conversation_patterns"):
            user_id = event.get("user_id", "")

            if not user_id:
                return {"error": "Missing user_id — runtime hook not wired."}

            if not MEMORY_ID:
                return {"error": "MEMORY_ID environment variable not configured"}

            result = _analyze(user_id, MEMORY_ID)
            return {"content": [{"type": "text", "text": json.dumps(result)}]}
        else:
            return {"error": f"This Lambda only supports 'analyze_patterns', received: {tool_name}"}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
