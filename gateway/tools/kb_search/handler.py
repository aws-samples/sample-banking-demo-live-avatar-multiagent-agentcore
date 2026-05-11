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


# Valid pipeline tags — must stay in sync with kb_ingest / pdf_generator / orchestrator.
VALID_PIPELINES = {"bistro_research", "open_research", "menu"}
MAX_PIPELINES = 10


def _sanitize_pipelines(pipelines) -> list[str]:
    """Return a deduplicated list of valid pipeline values, empty if none are valid.

    Unknown entries are logged and dropped rather than causing a hard error so
    the search still runs; the caller's own validation remains the source of
    truth for rejecting bad input.
    """
    if not pipelines:
        return []
    if not isinstance(pipelines, list):
        logger.warning("kb_search: pipelines must be a list, got %r", type(pipelines).__name__)
        return []
    cleaned: list[str] = []
    seen: set[str] = set()
    for p in pipelines[:MAX_PIPELINES]:
        if not isinstance(p, str):
            continue
        p = p.strip()
        if p not in VALID_PIPELINES:
            logger.warning("kb_search: dropping unknown pipeline value: %r", p)
            continue
        if p in seen:
            continue
        seen.add(p)
        cleaned.append(p)
    return cleaned


def _build_filter(user_id: str, pipelines: list[str]) -> dict | None:
    """Compose the Bedrock vectorSearchConfiguration filter.

    Shapes:
    - Neither: None (returns all docs).
    - user_id only: equals on user_id.
    - pipelines only (len 1): equals on pipeline.
    - pipelines only (len 2+): in on pipeline.
    - Both: andAll of user_id equals + pipeline equals/in.
    """
    user_clause: dict | None = None
    if user_id:
        user_clause = {"equals": {"key": "user_id", "value": user_id}}

    pipeline_clause: dict | None = None
    if pipelines:
        if len(pipelines) == 1:
            pipeline_clause = {"equals": {"key": "pipeline", "value": pipelines[0]}}
        else:
            pipeline_clause = {"in": {"key": "pipeline", "value": pipelines}}

    if user_clause and pipeline_clause:
        return {"andAll": [user_clause, pipeline_clause]}
    return user_clause or pipeline_clause


def _empty_result(query: str, reason: str) -> str:
    """Return a structured empty result with a machine-readable reason code.

    Used by the fail-closed scope check — the hook / runtime misconfigured
    the call, so we refuse to return anything. The reason surfaces in logs
    for debugging but carries no information the LLM can exploit.
    """
    return json.dumps(
        {
            "query": query,
            "results": [],
            "result_count": 0,
            "reason": reason,
        }
    )


def _retrieve_and_generate(
    knowledge_base_id: str,
    query: str,
    max_results: int,
    user_id: str = "",
    pipelines: list[str] | None = None,
) -> str:
    """Query Bedrock Knowledge Base using Retrieve.

    When user_id is provided, applies server-side Bedrock filtering to scope
    results to that user's generated research. When pipelines is provided,
    further scopes results to the given logical pipeline(s) (bistro_research,
    open_research, menu). Untagged shared documents are returned regardless
    because S3 Vectors only filters on documents that actually have the
    metadata key present.
    """
    vector_config: dict = {
        "numberOfResults": max_results,
        "overrideSearchType": "SEMANTIC",
    }

    # Input validation: reject obviously invalid user_id values
    if user_id and (not isinstance(user_id, str) or len(user_id) > 256):
        logger.warning("kb_search: invalid user_id rejected: %r", user_id)
        user_id = ""

    pipelines = _sanitize_pipelines(pipelines or [])

    # Per-user + per-pipeline scoping. The handler entrypoint enforces that
    # user_id is always set and pipelines is non-empty unless archive_mode=True
    # (the only legit "filter on user_id alone" path, used by the Report Archive).
    #
    # CAVEAT: S3 Vectors only evaluates filter clauses against documents that
    # have the metadata key present. Docs ingested without a `user_id` or
    # `pipeline` sidecar pass through every filter. kb_ingest now refuses to
    # write sidecars without user_id (see gateway/tools/kb_ingest/handler.py),
    # but pre-existing / manually-uploaded docs may still leak.
    # See docs/kb-isolation.md for mitigation runbook.
    composed_filter = _build_filter(user_id, pipelines)
    if composed_filter:
        vector_config["filter"] = composed_filter
    else:
        # Should only reach here when archive_mode=True and user_id is empty,
        # which the handler entrypoint blocks. Keep a loud warning if we do.
        logger.warning("kb_search: reached _retrieve_and_generate with no filter — invariant broken")

    logger.info(
        "Retrieving from KB %s with filter: %s (user_id=%s, pipelines=%s)",
        knowledge_base_id,
        vector_config.get("filter", "none"),
        bool(user_id),
        pipelines,
    )

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
            pipelines = event.get("pipelines", [])
            archive_mode = bool(event.get("archive_mode", False))

            if not query:
                return {"error": "Missing required parameter: query"}

            knowledge_base_id = os.environ.get("KNOWLEDGE_BASE_ID")
            if not knowledge_base_id:
                return {"error": "KNOWLEDGE_BASE_ID environment variable not configured"}

            # ── Fail-closed scope check ─────────────────────────────────────
            # The runtime hooks (UserScopeHook + PipelineScopeHook) MUST wire
            # up user_id and either a concrete pipelines list or archive_mode.
            # If either invariant is violated, refuse to return results — this
            # is the single source of truth for tenant + pipeline isolation.
            # S3 Vectors only evaluates filter clauses against documents that
            # have the metadata key present, which means missing-metadata docs
            # historically leaked to every user. Refusing at this layer shuts
            # that vector even for legacy/manually-uploaded documents.
            if not user_id:
                logger.warning("kb_search: refusing — missing user_id (UserScopeHook not wired?)")
                return {"content": [{"type": "text", "text": _empty_result(query, "caller-scope-required")}]}
            if not archive_mode and not pipelines:
                logger.warning(
                    "kb_search: refusing — missing pipelines and not in archive mode (user_id=%s)",
                    user_id,
                )
                return {"content": [{"type": "text", "text": _empty_result(query, "caller-scope-required")}]}

            result = _retrieve_and_generate(knowledge_base_id, query, max_results, user_id, pipelines)
            return {"content": [{"type": "text", "text": result}]}
        else:
            return {"error": f"This Lambda only supports 'kb_search', received: {tool_name}"}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}


# ── Smoke test ────────────────────────────────────────────────────────────
# Run directly (`python handler.py`) to verify filter shapes without hitting AWS.
if __name__ == "__main__":
    import pprint

    test_cases = [
        ("no filter", "", []),
        ("user only", "user-abc", []),
        ("single pipeline", "", ["menu"]),
        ("multi pipeline", "", ["bistro_research", "open_research"]),
        ("both user + single pipeline", "user-abc", ["menu"]),
        ("both user + multi pipeline", "user-abc", ["bistro_research", "menu"]),
        ("unknown pipeline dropped", "user-abc", ["bistro_research", "bogus"]),
        ("bogus pipelines type", "user-abc", "not-a-list"),
        ("duplicate pipelines deduped", "", ["menu", "menu", "open_research"]),
    ]
    for label, uid, pipes in test_cases:
        cleaned = _sanitize_pipelines(pipes) if isinstance(pipes, list) or pipes is None else _sanitize_pipelines(pipes)
        composed = _build_filter(uid, cleaned)
        print(f"\n[{label}]  user_id={uid!r}  pipelines={pipes!r}")
        print("  cleaned :", cleaned)
        print("  filter  :", end=" ")
        pprint.pprint(composed, compact=True)
