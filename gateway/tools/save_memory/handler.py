# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
save_memory — persist a memory record for a user.

Primary backend: AgentCore Memory's `CreateEvent` API. Events are grouped
by `actorId=user_id` and processed asynchronously by the configured
memory strategies (episodic, semantic, user_preference). This path does
not require knowledge of generated strategy IDs — the strategies index
the actor's events into their own namespaces automatically.

Fallback backend: Neptune Analytics graph. Uses parameterized openCypher
— never string interpolation of LLM-controlled content.

When neither backend is configured, returns a structured `{"status":
"disabled"}` rather than failing the tool call.
"""

import json
import logging
import os
import urllib.parse
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


def _execute_neptune_query(query: str, parameters: dict | None = None) -> dict:
    """Execute a parameterized openCypher query against Neptune Analytics.

    Uses Neptune's `parameters` form-field for bound variables so
    LLM-controlled values can't inject Cypher.
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


def _save_via_neptune(user_id: str, content: str, memory_type: str) -> str:
    """Fallback save path via Neptune graph with parameterized Cypher."""
    memory_id = str(uuid.uuid4())[:8]
    created_at = datetime.utcnow().isoformat()

    query = (
        "MERGE (u:User {userId: $user_id}) "
        "CREATE (m:Memory {memoryId: $memory_id, content: $content, "
        "type: $memory_type, createdAt: $created_at}) "
        "CREATE (u)-[:HAS_MEMORY]->(m) "
        "RETURN m.memoryId AS memoryId"
    )
    params = {
        "user_id": user_id,
        "memory_id": memory_id,
        "content": content,
        "memory_type": memory_type,
        "created_at": created_at,
    }
    _execute_neptune_query(query, params)

    return json.dumps(
        {
            "success": True,
            "memory_id": memory_id,
            "user_id": user_id,
            "memory_type": memory_type,
            "backend": "neptune",
            "message": f"Memory saved successfully with ID {memory_id}",
        }
    )


def _save_via_agentcore(user_id: str, memory_id: str, content: str, memory_type: str, session_id: str) -> str | None:
    """Primary save path via AgentCore Memory's CreateEvent API.

    Returns a JSON string on success, or None if the call fails (caller
    falls back to Neptune or returns disabled).

    The event payload uses the conversational shape — strategies extract
    facts / preferences / session summaries from it asynchronously.
    """
    try:
        agentcore_client = boto3.client("bedrock-agentcore")
        response = agentcore_client.create_event(
            memoryId=memory_id,
            actorId=user_id,
            sessionId=session_id,
            eventTimestamp=datetime.utcnow(),
            payload=[
                {
                    "conversational": {
                        "role": "ASSISTANT",
                        "content": {"text": content},
                    }
                }
            ],
        )
        event_id = response.get("event", {}).get("eventId", "")
        return json.dumps(
            {
                "success": True,
                "memory_id": event_id,
                "user_id": user_id,
                "memory_type": memory_type,
                "session_id": session_id,
                "backend": "agentcore",
                "message": "Memory event saved — strategies will index asynchronously.",
            }
        )
    except Exception as e:
        logger.warning("AgentCore Memory CreateEvent failed: %s", e)
        return None


def handler(event, context):
    """
    Save memory tool Lambda handler.

    Tries AgentCore Memory CreateEvent first; falls back to Neptune;
    returns `{"status": "disabled"}` if neither is configured.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name != "save_memory":
            return {"error": f"This Lambda only supports 'save_memory', received: {tool_name}"}

        user_id = event.get("user_id", "")
        content = event.get("content", "")
        memory_type = event.get("memory_type", "fact")
        session_id = event.get("session_id", "default")

        if not user_id:
            return {"error": "Missing required parameter: user_id"}
        if not content:
            return {"error": "Missing required parameter: content"}

        if memory_type not in ("fact", "preference", "context"):
            memory_type = "fact"

        memory_id = os.environ.get("MEMORY_ID", "")

        # 1. Primary: AgentCore Memory CreateEvent
        if memory_id:
            agentcore_result = _save_via_agentcore(user_id, memory_id, content, memory_type, session_id)
            if agentcore_result is not None:
                return {"content": [{"type": "text", "text": agentcore_result}]}

        # 2. Fallback: Neptune graph
        if NEPTUNE_ENDPOINT:
            result = _save_via_neptune(user_id, content, memory_type)
            return {"content": [{"type": "text", "text": result}]}

        # 3. Neither available — graceful disable.
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {
                            "success": False,
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
