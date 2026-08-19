# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Feedback API Lambda handler.

Two responsibilities:

* ``POST /feedback`` — persist a single feedback signal (a thumbs rating, a
  human edit, an applied A/B winner) to DynamoDB.
* ``GET /feedback/summary`` — read those signals back and aggregate them into
  the continuous-feedback-loop view the AI Assistant renders: approval rate,
  signal mix, A/B model win-rates, a day-bucketed trend, recent events and a
  few auto-generated recommendations.

The summary reads the ``feedbackType-timestamp-index`` GSI so it can scope to a
recent window and stay cheap as the table grows.
"""

import os
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.event_handler import APIGatewayRestResolver, CORSConfig
from aws_lambda_powertools.logging import correlation_paths
from boto3.dynamodb.conditions import Key

logger = Logger()
tracer = Tracer()

TABLE_NAME = os.environ.get("TABLE_NAME", "")
CORS_ALLOWED_ORIGINS = os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:3000")

# Human-readable labels for the signal sources the frontend tags. Anything not
# in this map falls through to its raw value, so a new source still renders.
SOURCE_LABELS = {
    "catalog_rating": "Catalog ratings",
    "chat_rating": "Chat ratings",
    "edit": "Human edits",
    "ab_test": "A/B winners",
    "prompt_update": "Prompt updates",
}

cors_config = CORSConfig(
    allow_origin=CORS_ALLOWED_ORIGINS.split(",")[0],
    allow_headers=["Content-Type", "Authorization"],
    max_age=300,
    extra_origins=CORS_ALLOWED_ORIGINS.split(",")[1:],
)
app = APIGatewayRestResolver(cors=cors_config)

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME) if TABLE_NAME else None


@app.post("/feedback")
@tracer.capture_method
def submit_feedback():
    """Store feedback in DynamoDB."""
    if not table:
        return {"statusCode": 500, "body": "TABLE_NAME not configured"}

    body = app.current_event.json_body
    feedback_type = body.get("feedbackType", "general")
    feedback_text = body.get("feedbackText", body.get("comment", ""))
    rating = body.get("rating")
    metadata = body.get("metadata", {})

    # Extract user from Cognito claims
    claims = app.current_event.request_context.authorizer
    user_email = claims.get("claims", {}).get("email", "anonymous") if claims else "anonymous"

    item = {
        "feedbackId": str(uuid.uuid4()),
        "feedbackType": feedback_type,
        "feedbackText": feedback_text,
        "rating": rating,
        "metadata": metadata,
        "userEmail": user_email,
        "timestamp": int(datetime.now(timezone.utc).timestamp()),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

    table.put_item(Item=item)
    logger.info("Feedback stored", extra={"feedbackId": item["feedbackId"]})

    return {"feedbackId": item["feedbackId"], "status": "stored"}


@app.get("/feedback/summary")
@tracer.capture_method
def feedback_summary():
    """Aggregate recent feedback into the continuous-loop dashboard payload."""
    if not table:
        return {"statusCode": 500, "body": "TABLE_NAME not configured"}

    # Window is bounded so the query stays cheap; callers may narrow it further.
    try:
        days = int(app.current_event.get_query_string_value("days", "30"))
    except (TypeError, ValueError):
        days = 30
    days = max(1, min(days, 365))
    cutoff = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())

    records = _query_recent(cutoff)
    return _aggregate(records, days)


def _query_recent(cutoff: int) -> list[dict]:
    """Read positive + negative signals since ``cutoff`` from the GSI."""
    records: list[dict] = []
    for feedback_type in ("positive", "negative"):
        kwargs = {
            "IndexName": "feedbackType-timestamp-index",
            "KeyConditionExpression": Key("feedbackType").eq(feedback_type) & Key("timestamp").gte(cutoff),
            "ScanIndexForward": False,
        }
        while True:
            page = table.query(**kwargs)
            records.extend(page.get("Items", []))
            token = page.get("LastEvaluatedKey")
            if not token:
                break
            kwargs["ExclusiveStartKey"] = token
    return records


def _aggregate(records: list[dict], days: int) -> dict:
    """Turn raw signal rows into the dashboard payload."""
    positive = sum(1 for r in records if r.get("feedbackType") == "positive")
    negative = sum(1 for r in records if r.get("feedbackType") == "negative")
    total = positive + negative

    by_source: Counter = Counter()
    by_model: Counter = Counter()
    trend_pos: dict[str, int] = defaultdict(int)
    trend_neg: dict[str, int] = defaultdict(int)

    for r in records:
        meta = r.get("metadata") or {}
        source = meta.get("source", "other")
        by_source[source] += 1
        if source == "ab_test" and meta.get("model"):
            by_model[meta["model"]] += 1
        day = str(r.get("createdAt", ""))[:10]
        if not day:
            continue
        if r.get("feedbackType") == "positive":
            trend_pos[day] += 1
        else:
            trend_neg[day] += 1

    edits = by_source.get("edit", 0)
    approval_rate = round(positive / total, 4) if total else 0.0
    edit_rate = round(edits / total, 4) if total else 0.0

    # Day-bucketed trend across the whole window, oldest first, zero-filled so
    # the chart has a continuous x-axis instead of gaps on quiet days.
    today = datetime.now(timezone.utc).date()
    trend = []
    for offset in range(days - 1, -1, -1):
        day = (today - timedelta(days=offset)).isoformat()
        trend.append({"date": day, "positive": trend_pos.get(day, 0), "negative": trend_neg.get(day, 0)})
    # Bound the trend to the active range (with one leading pad day) so a fresh
    # demo shows the days that actually have signals, not a flat month.
    active_idx = [i for i, d in enumerate(trend) if d["positive"] or d["negative"]]
    if active_idx:
        start = max(0, active_idx[0] - 1)
        trend = trend[start : active_idx[-1] + 1]
    else:
        trend = []

    recent = [
        {
            "feedbackType": r.get("feedbackType"),
            "source": (r.get("metadata") or {}).get("source", "other"),
            "itemName": (r.get("metadata") or {}).get("itemName", ""),
            "model": (r.get("metadata") or {}).get("model", ""),
            "createdAt": r.get("createdAt", ""),
        }
        for r in sorted(records, key=lambda x: x.get("timestamp", 0), reverse=True)[:12]
    ]

    top_model = by_model.most_common(1)[0] if by_model else None

    return {
        "windowDays": days,
        "totals": {
            "positive": positive,
            "negative": negative,
            "total": total,
            "approvalRate": approval_rate,
            "editRate": edit_rate,
        },
        "bySource": [{"source": s, "label": SOURCE_LABELS.get(s, s), "count": c} for s, c in by_source.most_common()],
        "byModel": [{"model": m, "wins": c} for m, c in by_model.most_common()],
        "topModel": {"model": top_model[0], "wins": top_model[1]} if top_model else None,
        "trend": trend,
        "recent": recent,
        "insights": _insights(total, approval_rate, edit_rate, top_model, by_model),
    }


def _insights(
    total: int,
    approval_rate: float,
    edit_rate: float,
    top_model,
    by_model: Counter,
) -> list[dict]:
    """Auto-generated recommendations, mirroring AgentCore Evaluations."""
    if total == 0:
        return [
            {
                "tone": "neutral",
                "text": "No feedback captured yet. Rate, edit or A/B a catalog item to start the loop.",
            }
        ]

    insights: list[dict] = []

    if top_model and top_model[1] >= 3:
        contested = sum(by_model.values())
        insights.append(
            {
                "tone": "positive",
                "text": (
                    f"{top_model[0]} won {top_model[1]} of {contested} A/B comparisons — "
                    "consider making it the catalog default."
                ),
            }
        )

    if edit_rate >= 0.3:
        insights.append(
            {
                "tone": "warning",
                "text": (
                    f"{round(edit_rate * 100)}% of signals were human edits — tighten the "
                    "designer's length and format quality control."
                ),
            }
        )

    if approval_rate >= 0.8:
        insights.append(
            {
                "tone": "positive",
                "text": (
                    f"Approval rate is {round(approval_rate * 100)}% across {total} signals — "
                    "the catalog is landing well with reviewers."
                ),
            }
        )
    elif approval_rate <= 0.5:
        insights.append(
            {
                "tone": "warning",
                "text": (
                    f"Approval rate is {round(approval_rate * 100)}% across {total} signals — "
                    "review the low-rated items and refine the designer prompt."
                ),
            }
        )

    if not insights:
        insights.append(
            {
                "tone": "neutral",
                "text": f"{total} signals captured. Keep reviewing to sharpen the recommendations.",
            }
        )

    return insights


@logger.inject_lambda_context(correlation_id_path=correlation_paths.API_GATEWAY_REST)
@tracer.capture_lambda_handler
def handler(event, context):
    """Lambda entry point."""
    return app.resolve(event, context)
