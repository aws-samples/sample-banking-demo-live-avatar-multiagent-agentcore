# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Run history API — lists a user's completed reports and mints fresh download URLs.

Why this exists
---------------
Report links used to break. `pdf_generator` returns a presigned S3 URL valid for
one hour, the frontend held it in client state only, and nothing minted a new
one. Any attempt to open a report from an earlier run — or after a page reload,
or simply more than an hour later — hit S3's `AccessDenied`, which reads like a
permissions bug rather than an expiry.

The fix is to never persist a presigned URL. `pdf_generator` writes a durable run
record holding the S3 key, and this endpoint signs a new URL on every request.
Links therefore keep working for as long as the object exists, which also makes a
browsable history possible.

Routes (both behind the API's Cognito authorizer):
    GET /reports              -> the caller's runs, newest first, each with a
                                 freshly signed download URL
    GET /reports/{reportId}   -> a single run, same shape

Scoping: the partition key is derived from the verified Cognito `sub` in the
authorizer claims, never from a query parameter, so one user cannot list
another's reports.
"""

import json
import logging
import os

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource("dynamodb")
s3_client = boto3.client("s3")

METADATA_TABLE = os.environ.get("METADATA_TABLE", "")
REPORTS_BUCKET = os.environ.get("REPORTS_BUCKET", "")

# Short enough that a leaked link is not a lasting exposure, long enough to read
# a report without it dying mid-scroll. A new URL is one request away.
URL_TTL_SECONDS = int(os.environ.get("URL_TTL_SECONDS", "900"))

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Content-Type": "application/json",
}


def _response(status: int, body: dict) -> dict:
    return {"statusCode": status, "headers": CORS_HEADERS, "body": json.dumps(body)}


def _user_id(event: dict) -> str:
    """Verified Cognito subject. API Gateway has already validated the JWT."""
    claims = (event.get("requestContext") or {}).get("authorizer", {}).get("claims", {})
    return claims.get("sub", "")


def _sign(s3_key: str, filename: str) -> str | None:
    """Mint a short-lived inline-display URL for one object."""
    try:
        return s3_client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": REPORTS_BUCKET,
                "Key": s3_key,
                "ResponseContentDisposition": f'inline; filename="{filename}"',
                "ResponseContentType": "application/pdf",
            },
            ExpiresIn=URL_TTL_SECONDS,
        )
    except ClientError as e:
        logger.warning("Could not sign %s: %s", s3_key, e)
        return None


def _to_item(record: dict) -> dict:
    s3_key = record.get("s3_key", "")
    filename = s3_key.rsplit("/", 1)[-1] or "report.pdf"
    return {
        "reportId": record.get("report_id", ""),
        "title": record.get("title", "Untitled report"),
        "pipeline": record.get("pipeline", ""),
        "mode": record.get("mode", ""),
        "createdAt": record.get("created_at", ""),
        "sizeBytes": int(record.get("size_bytes", 0) or 0),
        "filename": filename,
        # Signed per request. Deliberately not stored anywhere.
        "url": _sign(s3_key, filename),
    }


def handler(event, _context):
    if not METADATA_TABLE or not REPORTS_BUCKET:
        return _response(500, {"error": "METADATA_TABLE and REPORTS_BUCKET must be configured"})

    user_id = _user_id(event)
    if not user_id:
        # Should be unreachable behind the authorizer; fail closed rather than
        # falling back to an unscoped query.
        return _response(401, {"error": "Unauthenticated"})

    table = dynamodb.Table(METADATA_TABLE)
    report_id = (event.get("pathParameters") or {}).get("reportId")

    try:
        if report_id:
            # SK carries a timestamp prefix, so fetch by prefix rather than a
            # get_item on a key the caller does not know in full.
            resp = table.query(
                KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
                ExpressionAttributeValues={":pk": f"user#{user_id}", ":sk": "report#"},
            )
            match = next((r for r in resp.get("Items", []) if r.get("report_id") == report_id), None)
            if not match:
                return _response(404, {"error": "Report not found"})
            return _response(200, {"report": _to_item(match)})

        resp = table.query(
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={":pk": f"user#{user_id}", ":sk": "report#"},
            # SK sorts by ISO timestamp, so descending gives newest first.
            ScanIndexForward=False,
            Limit=100,
        )
        items = [_to_item(r) for r in resp.get("Items", [])]
        logger.info("Returning %d reports for user", len(items))
        return _response(200, {"reports": items, "count": len(items)})

    except ClientError as e:
        logger.error("DynamoDB error: %s", e, exc_info=True)
        return _response(500, {"error": "Could not read run history"})
