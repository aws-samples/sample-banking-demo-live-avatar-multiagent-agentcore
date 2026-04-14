# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging
import os

import boto3
from botocore.config import Config

logger = logging.getLogger()
logger.setLevel(logging.INFO)

bedrock_runtime = boto3.client(
    "bedrock-runtime",
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
    config=Config(read_timeout=3600),
)

MODEL_ID = os.environ.get("WEB_SEARCH_MODEL_ID", "us.amazon.nova-2-lite-v1:0")


def _web_search(query: str, max_results: int) -> str:
    """Perform web search using Amazon Nova Web Grounding."""
    try:
        response = bedrock_runtime.converse(
            modelId=MODEL_ID,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"text": query}
                    ],
                }
            ],
            system=[
                {
                    "text": (
                        "You are a web search tool. Return ONLY the factual answer "
                        "in 1-3 sentences. No commentary, no extra details, no lists "
                        "of observances or time zones. Be as brief as possible."
                    )
                }
            ],
            toolConfig={
                "tools": [{"systemTool": {"name": "nova_grounding"}}]
            },
        )

        # Extract text with interleaved citations
        content_list = response["output"]["message"]["content"]
        result_text = ""
        citations = []

        for block in content_list:
            if "text" in block:
                result_text += block["text"]
            elif "citationsContent" in block:
                for citation in block["citationsContent"].get("citations", []):
                    web = citation.get("location", {}).get("web", {})
                    if web.get("url"):
                        citations.append(
                            {"url": web["url"], "domain": web.get("domain", "")}
                        )

        return json.dumps(
            {
                "query": query,
                "results": result_text,
                "citations": citations,
                "result_count": len(citations),
                "source": "nova_web_grounding",
            }
        )

    except Exception as e:
        logger.error(f"Web search error: {str(e)}", exc_info=True)
        return json.dumps({"query": query, "error": str(e), "results": []})


def handler(event, context):
    """Web search tool Lambda handler using Nova Web Grounding."""
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[
            original_tool_name.index(delimiter) + len(delimiter) :
        ]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name == "web_search":
            query = event.get("query", "")
            max_results = event.get("max_results", 5)

            if not query:
                return {"error": "Missing required parameter: query"}

            result = _web_search(query, max_results)
            return {"content": [{"type": "text", "text": result}]}
        else:
            return {
                "error": f"This Lambda only supports 'web_search', received: {tool_name}"
            }

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
