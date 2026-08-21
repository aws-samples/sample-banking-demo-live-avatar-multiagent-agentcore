# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Status + results endpoint for the AI Assistant's Bedrock model-evaluation A/B.

The "Launch Bedrock evaluation" button fires two asynchronous Bedrock
model-as-a-judge jobs (one per model). Those jobs run for minutes, so the
frontend polls this endpoint (`GET /catalog-eval?jobs=<arn1>,<arn2>`) to show a
live "Queued / In progress / Completed" state and, once each job finishes, the
copy-quality score parsed from the job's S3 output.

Read-only and best-effort: any per-job error is reported in that job's entry and
never fails the whole response. Cognito-authorized at the API Gateway method.
"""

import json
import logging
import os

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION = os.environ.get("AWS_REGION", "us-east-1")
CORS_ORIGINS = os.environ.get("CORS_ALLOWED_ORIGINS", "*")
# Bedrock terminal job states.
_TERMINAL = {"Completed", "Failed", "Stopped", "Deleting"}

_bedrock = boto3.client("bedrock", region_name=REGION)
_s3 = boto3.client("s3", region_name=REGION)


def _headers() -> dict:
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": CORS_ORIGINS,
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
    }


def _split_s3_uri(uri: str) -> tuple[str, str]:
    rest = uri.replace("s3://", "", 1)
    bucket, _, prefix = rest.partition("/")
    return bucket, prefix


METRIC_NAME = "copy_quality"


def _score_from_output(output_s3_uri: str) -> float | None:
    """Read a completed job's S3 output and return the mean copy_quality score
    on a 0-100 scale, or None if it cannot be determined.

    Verified output shape (one JSON object per line under
    ``.../models/<id>/taskTypes/General/datasets/<name>/<uuid>_output.jsonl``):

        {"automatedEvaluationResult": {"scores": [
            {"metricName": "copy_quality", "result": 1.0, "evaluatorDetails": [...]}
        ]}, "inputRecord": {...}, "modelResponses": [...]}

    ``result`` is normalized to 0-1 (our two-point excellent/poor scale yields
    1.0 / 0.0), so the mean is scaled to 0-100 for display.
    """
    try:
        bucket, prefix = _split_s3_uri(output_s3_uri)
        keys: list[str] = []
        token: dict = {}
        while True:
            resp = _s3.list_objects_v2(Bucket=bucket, Prefix=prefix, **token)
            keys.extend(o["Key"] for o in resp.get("Contents", []) if o["Key"].endswith("_output.jsonl"))
            if not resp.get("IsTruncated"):
                break
            token = {"ContinuationToken": resp["NextContinuationToken"]}

        results: list[float] = []
        for key in keys:
            body = _s3.get_object(Bucket=bucket, Key=key)["Body"].read().decode("utf-8", "replace")
            for line in body.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                for sc in (rec.get("automatedEvaluationResult") or {}).get("scores", []) or []:
                    if sc.get("metricName") != METRIC_NAME:
                        continue
                    val = sc.get("result")
                    if isinstance(val, (int, float)) and not isinstance(val, bool):
                        results.append(float(val))
        if not results:
            return None
        mean = sum(results) / len(results)
        # result is 0-1 for our scale; scale to 0-100. Guard against a job that
        # ever returns raw 0-100 by only scaling when clearly a fraction.
        return round(mean * 100, 1) if mean <= 1.0 else round(mean, 1)
    except Exception as exc:  # noqa: BLE001 - best effort
        logger.warning("score parse failed for %s: %s", output_s3_uri, exc)
        return None


def _job_entry(job_arn: str) -> dict:
    entry: dict = {"jobArn": job_arn, "status": "Unknown", "done": False, "score": None}
    try:
        j = _bedrock.get_evaluation_job(jobIdentifier=job_arn)
        status = j.get("status", "Unknown")
        entry["status"] = status
        entry["jobName"] = j.get("jobName")
        entry["done"] = status in _TERMINAL
        if status == "Completed":
            out = (j.get("outputDataConfig") or {}).get("s3Uri")
            if out:
                entry["score"] = _score_from_output(out)
        elif status == "Failed":
            entry["failure"] = (j.get("failureMessages") or [""])[0][:300]
    except Exception as exc:  # noqa: BLE001 - report per-job, never 500 the response
        logger.warning("get_evaluation_job failed for %s: %s", job_arn, exc)
        entry["status"] = "Error"
        entry["error"] = str(exc)[:200]
    return entry


def handler(event, _context):
    if (event.get("httpMethod") or "").upper() == "OPTIONS":
        return {"statusCode": 200, "headers": _headers(), "body": "{}"}
    params = event.get("queryStringParameters") or {}
    raw = params.get("jobs") or ""
    job_arns = [a for a in (s.strip() for s in raw.split(",")) if a]
    if not job_arns:
        return {"statusCode": 400, "headers": _headers(), "body": json.dumps({"error": "missing jobs"})}
    # Bound the fan-out; the A/B is two jobs.
    jobs = [_job_entry(a) for a in job_arns[:4]]
    body = {"jobs": jobs, "allDone": all(j["done"] for j in jobs)}
    return {"statusCode": 200, "headers": _headers(), "body": json.dumps(body)}
