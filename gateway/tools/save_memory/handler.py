# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging
import os
import urllib.request
import uuid
from datetime import datetime

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


def _save_memory(user_id: str, content: str, memory_type: str) -> str:
    """Save a memory node to the Neptune graph."""
    memory_id = str(uuid.uuid4())[:8]
    created_at = datetime.utcnow().isoformat()

    # Escape single quotes in content for Cypher
    safe_content = content.replace("'", "\\'").replace('"', '\\"')

    # Create or merge user node, then create memory node linked to user
    query = (
        f"MERGE (u:User {{userId: '{user_id}'}}) "
        f"CREATE (m:Memory {{memoryId: '{memory_id}', content: '{safe_content}', "
        f"type: '{memory_type}', createdAt: '{created_at}'}}) "
        f"CREATE (u)-[:HAS_MEMORY]->(m) "
        f"RETURN m.memoryId AS memoryId"
    )

    _execute_neptune_query(query)

    return json.dumps(
        {
            "success": True,
            "memory_id": memory_id,
            "user_id": user_id,
            "memory_type": memory_type,
            "message": f"Memory saved successfully with ID {memory_id}",
        }
    )


def handler(event, context):
    """
    Save memory tool Lambda handler.

    Writes a memory node to a Neptune Analytics graph, linked to the user.
    Supports memory types: fact, preference, context.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name == "save_memory":
            user_id = event.get("user_id", "")
            content = event.get("content", "")
            memory_type = event.get("memory_type", "fact")

            if not user_id:
                return {"error": "Missing required parameter: user_id"}
            if not content:
                return {"error": "Missing required parameter: content"}
            if not NEPTUNE_ENDPOINT:
                return {"error": "NEPTUNE_ENDPOINT environment variable not configured"}

            if memory_type not in ("fact", "preference", "context"):
                memory_type = "fact"

            result = _save_memory(user_id, content, memory_type)
            return {"content": [{"type": "text", "text": result}]}
        else:
            return {"error": f"This Lambda only supports 'save_memory', received: {tool_name}"}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
