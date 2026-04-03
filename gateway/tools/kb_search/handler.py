# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging
import os
from urllib.parse import urlparse

import boto3
from botocore.config import Config

logger = logging.getLogger()
logger.setLevel(logging.INFO)

bedrock_agent = boto3.client(
    "bedrock-agent-runtime",
    config=Config(
        retries={"max_attempts": 3, "mode": "adaptive"},
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
    ),
)

s3_client = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))


def _presign_s3_uri(s3_uri: str, page: int | None = None) -> str | None:
    """Generate a presigned URL for an S3 URI with inline display headers."""
    if not s3_uri or not s3_uri.startswith("s3://"):
        return None
    try:
        parsed = urlparse(s3_uri)
        bucket = parsed.netloc
        key = parsed.path.lstrip("/")
        url = s3_client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": bucket,
                "Key": key,
                "ResponseContentDisposition": "inline",
                "ResponseContentType": "application/pdf",
            },
            ExpiresIn=3600,
        )
        if page:
            url += f"#page={page}"
        return url
    except Exception as e:
        logger.warning(f"Failed to presign {s3_uri}: {e}")
        return None


def _retrieve_and_generate(knowledge_base_id: str, query: str, max_results: int, user_id: str = "") -> str:
    """Query Bedrock Knowledge Base using Retrieve.

    When user_id is provided, applies server-side Bedrock filtering to scope
    results to that user's generated research. Untagged shared documents are
    returned regardless because S3 Vectors only filters on documents that
    actually have the metadata key present.
    """
    vector_config: dict = {
        "numberOfResults": max_results,
        "overrideSearchType": "SEMANTIC",
    }

    # Input validation: reject obviously invalid user_id values
    if user_id and (not isinstance(user_id, str) or len(user_id) > 256):
        logger.warning("kb_search: invalid user_id rejected: %r", user_id)
        user_id = ""

    # Optional per-user scoping: when user_id is provided, prefer that user's
    # generated docs. Documents without a user_id tag (shared base docs) are
    # always included because S3 Vectors only filters on documents that have
    # the metadata key — untagged documents pass through automatically.
    if user_id:
        vector_config["filter"] = {"equals": {"key": "user_id", "value": user_id}}
    else:
        logger.info("kb_search: no user_id provided, returning all docs (unfiltered)")

    logger.info(f"Retrieving from KB {knowledge_base_id} with filter: {vector_config.get('filter', 'none')}")

    response = bedrock_agent.retrieve(
        knowledgeBaseId=knowledge_base_id,
        retrievalQuery={"text": query},
        retrievalConfiguration={"vectorSearchConfiguration": vector_config},
    )

    results = response.get("retrievalResults", [])

    logger.info(
        f"Retrieved {len(results)} results, metadata keys: {[list(r.get('metadata', {}).keys()) for r in results[:3]]}"
    )

    # Filter out Bedrock's internal permission-check files
    results = [
        r
        for r in results
        if "tmp-permission-check-file" not in r.get("location", {}).get("s3Location", {}).get("uri", "")
    ]

    if not results:
        return json.dumps({"query": query, "results": [], "result_count": 0})

    formatted = []
    citations = []
    # Deduplicate documents for the document list
    seen_sources: dict[str, dict] = {}

    for idx, item in enumerate(results, 1):
        content_text = item.get("content", {}).get("text", "")
        score = item.get("score", 0.0)
        location = item.get("location", {})
        s3_uri = location.get("s3Location", {}).get("uri", "")
        metadata = item.get("metadata", {})
        page = metadata.get("x-amz-bedrock-kb-document-page-number")
        page_int = int(page) if page else None

        presigned_url = _presign_s3_uri(s3_uri, page_int)

        formatted.append(
            {
                "content": content_text,
                "score": score,
                "source": s3_uri,
                "page": page_int,
                "citation_id": idx,
                "url": presigned_url,
            }
        )

        filename = s3_uri.split("/")[-1] if s3_uri else "Unknown"
        citations.append(
            {
                "id": idx,
                "source": filename,
                "snippet": content_text[:200] + "..." if len(content_text) > 200 else content_text,
                "score": score,
                "page": page_int,
                "url": presigned_url,
            }
        )

        # Track unique documents for the document list
        if s3_uri and s3_uri not in seen_sources:
            seen_sources[s3_uri] = {
                "filename": filename,
                "s3_uri": s3_uri,
                "url": _presign_s3_uri(s3_uri),  # URL without page anchor
                "pages_referenced": [],
            }
        if s3_uri and page_int:
            seen_sources[s3_uri]["pages_referenced"].append(page_int)

    # Build deduplicated document list
    documents = list(seen_sources.values())
    for doc in documents:
        doc["pages_referenced"] = sorted(set(doc["pages_referenced"]))

    return json.dumps(
        {
            "query": query,
            "results": formatted,
            "citations": citations,
            "documents": documents,
            "result_count": len(formatted),
            "citation_format": "Use [KB1], [KB2], etc. to reference knowledge base sources",
        }
    )


def handler(event, context):
    """
    Bedrock Knowledge Base search tool Lambda handler.

    Queries an Amazon Bedrock Knowledge Base using hybrid (vector + keyword) search
    and returns formatted results with citations.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name == "kb_search":
            query = event.get("query", "")
            max_results = event.get("max_results", 5)
            user_id = event.get("user_id", "")

            if not query:
                return {"error": "Missing required parameter: query"}

            knowledge_base_id = os.environ.get("KNOWLEDGE_BASE_ID")
            if not knowledge_base_id:
                return {"error": "KNOWLEDGE_BASE_ID environment variable not configured"}

            result = _retrieve_and_generate(knowledge_base_id, query, max_results, user_id)
            return {"content": [{"type": "text", "text": result}]}
        else:
            return {"error": f"This Lambda only supports 'kb_search', received: {tool_name}"}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
