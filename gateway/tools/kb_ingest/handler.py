# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
KB Auto-Ingestion Lambda — triggered by S3 ObjectCreated events on reportsBucket.

Copies generated PDFs to kbDocsBucket under `generated/` prefix with S3 object tags
(source=generated, generated_date, pipeline), then starts a Bedrock KB ingestion job.

Also writes a `.metadata.json` sidecar for each PDF so Bedrock KB can filter by user_id.
"""

import json
import logging
import os
import urllib.parse
from datetime import datetime, timezone

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")
bedrock_agent = boto3.client("bedrock-agent")

KB_DOCS_BUCKET = os.environ["KB_DOCS_BUCKET"]
KNOWLEDGE_BASE_ID = os.environ["KNOWLEDGE_BASE_ID"]
DATA_SOURCE_ID = os.environ["DATA_SOURCE_ID"]


# Allowed logical pipelines — must stay in sync with pdf_generator / kb_search / orchestrator.
VALID_PIPELINES = {"bistro_research", "open_research", "menu"}

# Legacy alias: the previous iteration tagged everything in reports/ as "research".
# Migrate those to "bistro_research" since the original flow (the Bistro Deep Dive
# pipeline) was the only research writer at the time.
LEGACY_PIPELINE_ALIASES = {"research": "bistro_research"}


def _resolve_pipeline(src_key: str, source_metadata: dict | None) -> str:
    """Determine the pipeline tag for a newly uploaded PDF.

    Resolution order:
      1. Source object's `pipeline` S3 metadata (set by pdf_generator).
         Legacy value `research` is mapped to `bistro_research`.
      2. Prefix-based inference: `reports/` -> `bistro_research`, `menus/` -> `menu`.
      3. Fallback: `unknown` (document still ingests; simply not scoped by filter).
    """
    meta = source_metadata or {}
    raw = (meta.get("pipeline") or "").strip().lower()
    raw = LEGACY_PIPELINE_ALIASES.get(raw, raw)
    if raw in VALID_PIPELINES:
        return raw

    key_lower = src_key.lower()
    if key_lower.startswith("reports/"):
        return "bistro_research"
    if key_lower.startswith("menus/"):
        return "menu"
    return "unknown"


def handler(event, context):
    """Process S3 ObjectCreated events: copy to KB bucket + start ingestion."""
    logger.info("KB ingest triggered with %d record(s)", len(event.get("Records", [])))

    for record in event.get("Records", []):
        src_bucket = record["s3"]["bucket"]["name"]
        src_key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])

        # Skip non-PDF files (safety check — S3 filter should already handle this)
        if not src_key.lower().endswith(".pdf"):
            logger.info("Skipping non-PDF: %s", src_key)
            continue

        # Read source object metadata up-front so we can use it for both
        # pipeline detection and per-user scoping.
        source_metadata: dict = {}
        user_id = ""
        try:
            head = s3.head_object(Bucket=src_bucket, Key=src_key)
            source_metadata = head.get("Metadata", {}) or {}
            user_id = source_metadata.get("user_id", "")
        except Exception as e:
            logger.warning("Failed to read metadata from source object: %s", e)

        pipeline = _resolve_pipeline(src_key, source_metadata)
        dest_key = f"generated/{src_key}"
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        tagging = f"source=generated&generated_date={today}&pipeline={pipeline}"

        logger.info(
            "Copying s3://%s/%s → s3://%s/%s (tags: %s, user_id: %s)",
            src_bucket,
            src_key,
            KB_DOCS_BUCKET,
            dest_key,
            tagging,
            user_id or "none",
        )

        s3.copy_object(
            CopySource={"Bucket": src_bucket, "Key": src_key},
            Bucket=KB_DOCS_BUCKET,
            Key=dest_key,
            Tagging=tagging,
            TaggingDirective="REPLACE",
        )

        # Write .metadata.json sidecar so Bedrock KB indexes `user_id` and `pipeline`
        # as filterable attributes (kb_search uses these for per-user + per-pipeline
        # scoping).
        metadata_attrs = {"source": "generated", "pipeline": pipeline}
        if user_id:
            metadata_attrs["user_id"] = user_id
        sidecar_key = dest_key + ".metadata.json"
        s3.put_object(
            Bucket=KB_DOCS_BUCKET,
            Key=sidecar_key,
            Body=json.dumps({"metadataAttributes": metadata_attrs}),
            ContentType="application/json",
        )
        logger.info("Wrote metadata sidecar: s3://%s/%s", KB_DOCS_BUCKET, sidecar_key)

    # Start ingestion job (once per invocation, not per file)
    response = bedrock_agent.start_ingestion_job(
        knowledgeBaseId=KNOWLEDGE_BASE_ID,
        dataSourceId=DATA_SOURCE_ID,
    )

    job_id = response["ingestionJob"]["ingestionJobId"]
    logger.info(
        "Started KB ingestion job %s for KB %s / DS %s",
        job_id,
        KNOWLEDGE_BASE_ID,
        DATA_SOURCE_ID,
    )

    return {"statusCode": 200, "ingestionJobId": job_id}


# ── Smoke test ────────────────────────────────────────────────────────────
# Run directly (`python handler.py`) to verify pipeline resolution without hitting AWS.
if __name__ == "__main__":
    cases = [
        # (src_key, metadata, expected)
        ("reports/foo.pdf", {"pipeline": "bistro_research"}, "bistro_research"),
        ("reports/foo.pdf", {"pipeline": "open_research"}, "open_research"),
        ("menus/foo.pdf", {"pipeline": "menu"}, "menu"),
        ("reports/foo.pdf", {"pipeline": "research"}, "bistro_research"),  # legacy alias
        ("reports/foo.pdf", {}, "bistro_research"),  # fallback to prefix
        ("menus/foo.pdf", {}, "menu"),  # fallback to prefix
        ("other/foo.pdf", {}, "unknown"),
        ("reports/foo.pdf", {"pipeline": "bogus"}, "bistro_research"),  # bad value -> fallback
        ("reports/foo.pdf", None, "bistro_research"),
    ]
    for src_key, meta, expected in cases:
        actual = _resolve_pipeline(src_key, meta)
        status = "OK " if actual == expected else "FAIL"
        print(f"{status}  key={src_key!r:35s} meta={str(meta):40s} -> {actual!r} (expected {expected!r})")
