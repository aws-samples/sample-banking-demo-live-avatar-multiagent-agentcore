# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Is the latest deep-research report queryable yet?

Why this exists
---------------
Knowledge Base ingestion is asynchronous. `pdf_generator` writes the PDF, an S3
event fires `kb_ingest`, and `StartIngestionJob` returns immediately — chunking
and embedding finish some tens of seconds to a few minutes later. Nothing waited
for that.

So running the AI Assistant straight after the Deep Research Agent could produce
a catalog with no grounding at all: `kb_search` legitimately returned nothing and
the designer fell back to the standing product set, silently. To an operator that
looks like the grounding feature is broken.

This endpoint reports whether the newest report is actually retrievable, so the
UI can say "indexing…" instead of quietly producing an ungrounded catalog.

Scoping: the partition key comes from the verified Cognito `sub` in the
authorizer claims, never from a query parameter.
"""

import json
import logging
import os

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

METADATA_TABLE = os.environ.get("METADATA_TABLE", "")
KNOWLEDGE_BASE_ID = os.environ.get("KNOWLEDGE_BASE_ID", "")
DATA_SOURCE_ID = os.environ.get("DATA_SOURCE_ID", "")
# Which corpus the AI Assistant grounds itself in.
PIPELINE = os.environ.get("GROUNDING_PIPELINE", "strategy_research")

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

# Ingestion job states that mean "still working".
_IN_FLIGHT = {"STARTING", "IN_PROGRESS"}


def _response(status: int, body: dict) -> dict:
    return {"statusCode": status, "headers": CORS_HEADERS, "body": json.dumps(body)}


def _user_id(event: dict) -> str:
    claims = (event.get("requestContext") or {}).get("authorizer", {}).get("claims", {})
    return claims.get("sub", "")


def _latest_report(user_id: str) -> dict | None:
    """Newest report for this user in the grounding pipeline, or None."""
    if not METADATA_TABLE:
        return None
    try:
        table = boto3.resource("dynamodb").Table(METADATA_TABLE)
        # SK is `report#{iso_timestamp}#{report_id}`, so descending is newest
        # first. A small page is enough: we only need the newest match, and the
        # other pipeline's rows are interleaved.
        resp = table.query(
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={":pk": f"user#{user_id}", ":sk": "report#"},
            ScanIndexForward=False,
            Limit=25,
        )
    except Exception as exc:
        logger.warning("research-status: report query failed: %s", exc)
        return None

    for item in resp.get("Items", []):
        if item.get("pipeline") == PIPELINE:
            return {
                "reportId": item.get("report_id", ""),
                "title": item.get("title", "Untitled report"),
                "createdAt": item.get("created_at", ""),
            }
    return None


def _ingestion_state(report_created_at: str) -> tuple[str, str]:
    """Return (state, detail) for the newest report.

    States:
      indexing  — an ingestion job is in flight
      ready     — a job completed at or after the report was written
      pending   — no in-flight job, but none has completed since the report
      unknown   — ingestion cannot be inspected (not configured / API error)
    """
    if not (KNOWLEDGE_BASE_ID and DATA_SOURCE_ID):
        return "unknown", "Knowledge Base not configured"
    try:
        client = boto3.client("bedrock-agent")
        resp = client.list_ingestion_jobs(
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
            dataSourceId=DATA_SOURCE_ID,
            sortBy={"attribute": "STARTED_AT", "order": "DESCENDING"},
            maxResults=10,
        )
    except Exception as exc:
        # Never fail the page over telemetry — report unknown and let the UI
        # allow the user through rather than blocking them behind a broken read.
        logger.warning("research-status: list_ingestion_jobs failed: %s", exc)
        return "unknown", "Could not read ingestion status"

    summaries = resp.get("ingestionJobSummaries", [])
    if any(s.get("status") in _IN_FLIGHT for s in summaries):
        return "indexing", "Indexing the strategy report"

    for summary in summaries:
        if summary.get("status") != "COMPLETE":
            continue
        finished = summary.get("updatedAt")
        finished_iso = finished.isoformat() if hasattr(finished, "isoformat") else str(finished or "")
        # String compare is safe: both are ISO-8601 UTC timestamps.
        if report_created_at and finished_iso >= report_created_at:
            return "ready", "Strategy report is queryable"
        break

    return "pending", "Report written but not yet indexed"


def handler(event, _context):  # noqa: ANN001
    if not METADATA_TABLE:
        return _response(500, {"error": "METADATA_TABLE must be configured"})

    user_id = _user_id(event)
    if not user_id:
        # Unreachable behind the Cognito authorizer; fail closed regardless.
        return _response(401, {"error": "Unauthenticated"})

    report = _latest_report(user_id)
    if not report:
        return _response(
            200,
            {
                "latestReport": None,
                "ingestion": {"state": "none", "detail": "No deep research report yet"},
                # Not "ready", but not blocking either: with no report at all the
                # assistant can still design from the standing product set.
                "ready": False,
                "pipeline": PIPELINE,
            },
        )

    state, detail = _ingestion_state(report["createdAt"])
    return _response(
        200,
        {
            "latestReport": report,
            "ingestion": {"state": state, "detail": detail},
            # `unknown` counts as ready so a permissions or API problem cannot
            # permanently lock the operator out of the AI Assistant.
            "ready": state in ("ready", "unknown"),
            "pipeline": PIPELINE,
        },
    )
