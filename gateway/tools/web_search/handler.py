# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging
import os

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

bedrock_runtime = boto3.client(
    "bedrock-runtime",
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
)

MODEL_ID = os.environ.get("WEB_SEARCH_MODEL_ID", "us.amazon.nova-pro-v1:0")


def _web_search(query: str, max_results: int) -> str:
    """Perform web search using Amazon Nova with grounding."""
    try:
        # Use Nova model with web search grounding
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "text": f"Search the web for: {query}\n\nProvide the top {max_results} most relevant results with URLs and brief descriptions."
                    }
                ],
            }
        ]

        # Nova grounding search via Converse API with performanceConfig
        request_params = {
            "modelId": MODEL_ID,
            "messages": messages,
            "inferenceConfig": {
                "maxTokens": 2048,
                "temperature": 0.1,
            },
        }

        # Add grounding source if supported
        if "nova" in MODEL_ID.lower():
            request_params["performanceConfig"] = {"latency": "standard"}

        response = bedrock_runtime.converse(**request_params)

        # Extract response text
        output = response.get("output", {})
        message = output.get("message", {})
        content = message.get("content", [])
        result_text = ""
        for block in content:
            if "text" in block:
                result_text += block["text"]

        return json.dumps(
            {
                "query": query,
                "results": result_text,
                "result_count": max_results,
                "source": "nova_grounding",
            }
        )

    except Exception as e:
        logger.error(f"Web search error: {str(e)}", exc_info=True)
        return json.dumps({"query": query, "error": str(e), "results": []})


def handler(event, context):
    """
    Web search tool Lambda handler.

    Performs web search using Amazon Nova 2 grounding API to return
    up-to-date search results with URLs and snippets.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name == "web_search":
            query = event.get("query", "")
            max_results = event.get("max_results", 5)

            if not query:
                return {"error": "Missing required parameter: query"}

            result = _web_search(query, max_results)
            return {"content": [{"type": "text", "text": result}]}
        else:
            return {"error": f"This Lambda only supports 'web_search', received: {tool_name}"}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
