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


def _recall_memories(user_id: str, query: str, limit: int) -> str:
    """Recall memories from the Neptune graph for a user."""
    # Escape query for Cypher
    safe_query = query.replace("'", "\\'").replace('"', '\\"') if query else ""

    if safe_query:
        # Search for memories matching the query
        cypher = (
            f"MATCH (u:User {{userId: '{user_id}'}})-[:HAS_MEMORY]->(m:Memory) "
            f"WHERE m.content CONTAINS '{safe_query}' "
            f"RETURN m.memoryId AS memoryId, m.content AS content, "
            f"m.type AS type, m.createdAt AS createdAt "
            f"ORDER BY m.createdAt DESC LIMIT {limit}"
        )
    else:
        # Return all memories for the user
        cypher = (
            f"MATCH (u:User {{userId: '{user_id}'}})-[:HAS_MEMORY]->(m:Memory) "
            f"RETURN m.memoryId AS memoryId, m.content AS content, "
            f"m.type AS type, m.createdAt AS createdAt "
            f"ORDER BY m.createdAt DESC LIMIT {limit}"
        )

    result = _execute_neptune_query(cypher)

    # Format results
    memories = []
    results_data = result.get("results", [])
    for row in results_data:
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
        }
    )


def handler(event, context):
    """
    Recall memories tool Lambda handler.

    Reads memories from a Neptune Analytics graph for a specific user.
    Optionally filters by a search query string.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name == "recall_memories":
            user_id = event.get("user_id", "")
            query = event.get("query", "")
            limit = event.get("limit", 10)

            if not user_id:
                return {"error": "Missing required parameter: user_id"}

            # Primary: AgentCore Memory retrieval
            memory_id = os.environ.get("MEMORY_ID", "")
            strategy_id = os.environ.get("MEMORY_STRATEGY_ID", "")
            if memory_id:
                try:
                    agentcore_client = boto3.client("bedrock-agentcore")
                    # Build namespace scoped to strategy + user
                    namespace = f"/strategies/{strategy_id}/actors/{user_id}/" if strategy_id else None
                    retrieve_kwargs = {
                        "memoryId": memory_id,
                        "searchCriteria": {"searchQuery": query, "topK": limit},
                        "maxResults": limit,
                    }
                    if namespace:
                        retrieve_kwargs["namespace"] = namespace
                    memory_response = agentcore_client.retrieve_memory_records(**retrieve_kwargs)
                    records = memory_response.get("memoryRecords", [])
                    if records:
                        memory_results = [
                            {
                                "content": r.get("content", ""),
                                "timestamp": r.get("timestamp", ""),
                            }
                            for r in records
                        ]
                        return {
                            "content": [
                                {
                                    "type": "text",
                                    "text": json.dumps({"memories": memory_results}),
                                }
                            ]
                        }
                except Exception as e:
                    logger.warning("AgentCore Memory retrieval failed, falling back: %s", str(e))

            # Fallback: Neptune graph memory
            if not NEPTUNE_ENDPOINT:
                return {"error": "No memory backend configured (MEMORY_ID and NEPTUNE_ENDPOINT both unavailable)"}

            result = _recall_memories(user_id, query, limit)
            return {"content": [{"type": "text", "text": result}]}
        else:
            return {"error": f"This Lambda only supports 'recall_memories', received: {tool_name}"}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
