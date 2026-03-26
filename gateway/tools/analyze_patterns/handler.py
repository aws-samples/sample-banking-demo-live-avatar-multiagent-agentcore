# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging
import os
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


def _execute_neptune_query(query: str) -> dict:
    """Execute an openCypher query against Neptune Analytics."""
    url = f"https://{NEPTUNE_ENDPOINT}/queries"
    body = f"query={query}&lang=opencypher"

    headers = _sign_request("POST", url, body)
    headers["Content-Type"] = "application/x-www-form-urlencoded"

    req = urllib.request.Request(url, data=body.encode("utf-8"), headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=300) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as e:
        logger.error(f"Neptune query failed: {e}")
        raise


def _analyze_patterns(user_id: str) -> str:
    """Run analytics queries on the Neptune graph for a user."""
    analysis = {
        "user_id": user_id,
        "memory_summary": {},
        "topic_distribution": {},
        "temporal_patterns": {},
    }

    # 1. Memory count by type
    type_query = (
        f"MATCH (u:User {{userId: '{user_id}'}})-[:HAS_MEMORY]->(m:Memory) "
        f"RETURN m.type AS type, count(m) AS count "
        f"ORDER BY count DESC"
    )
    try:
        type_result = _execute_neptune_query(type_query)
        type_counts = {}
        for row in type_result.get("results", []):
            type_counts[row.get("type", "unknown")] = row.get("count", 0)
        analysis["memory_summary"] = {
            "by_type": type_counts,
            "total": sum(type_counts.values()),
        }
    except Exception as e:
        logger.warning(f"Failed to get memory type counts: {e}")
        analysis["memory_summary"] = {"error": str(e)}

    # 2. Recent memory activity
    recent_query = (
        f"MATCH (u:User {{userId: '{user_id}'}})-[:HAS_MEMORY]->(m:Memory) "
        f"RETURN m.content AS content, m.type AS type, m.createdAt AS createdAt "
        f"ORDER BY m.createdAt DESC LIMIT 5"
    )
    try:
        recent_result = _execute_neptune_query(recent_query)
        recent_memories = []
        for row in recent_result.get("results", []):
            recent_memories.append(
                {
                    "content": row.get("content", "")[:100],
                    "type": row.get("type", ""),
                    "created_at": row.get("createdAt", ""),
                }
            )
        analysis["temporal_patterns"] = {
            "recent_activity": recent_memories,
            "recent_count": len(recent_memories),
        }
    except Exception as e:
        logger.warning(f"Failed to get recent memories: {e}")
        analysis["temporal_patterns"] = {"error": str(e)}

    # 3. Connected entities (topics/themes)
    entity_query = (
        f"MATCH (u:User {{userId: '{user_id}'}})-[:HAS_MEMORY]->(m:Memory) "
        f"RETURN m.type AS topic, count(m) AS mentions "
        f"ORDER BY mentions DESC LIMIT 10"
    )
    try:
        entity_result = _execute_neptune_query(entity_query)
        topics = {}
        for row in entity_result.get("results", []):
            topics[row.get("topic", "unknown")] = row.get("mentions", 0)
        analysis["topic_distribution"] = topics
    except Exception as e:
        logger.warning(f"Failed to get topic distribution: {e}")
        analysis["topic_distribution"] = {"error": str(e)}

    return json.dumps(analysis)


def handler(event, context):
    """
    Conversation pattern analysis tool Lambda handler.

    Runs analytics queries on the Neptune graph to identify patterns
    in a user's conversation history, including memory distribution,
    topic trends, and temporal activity.
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
                return {"error": "Missing required parameter: user_id"}
            if not NEPTUNE_ENDPOINT:
                return {"error": "NEPTUNE_ENDPOINT environment variable not configured"}

            result = _analyze_patterns(user_id)
            return {"content": [{"type": "text", "text": result}]}
        else:
            return {"error": f"This Lambda only supports 'analyze_patterns', received: {tool_name}"}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
