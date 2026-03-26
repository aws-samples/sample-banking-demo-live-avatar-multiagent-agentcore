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

        # Determine pipeline from prefix
        if src_key.startswith("reports/"):
            pipeline = "research"
        elif src_key.startswith("menus/"):
            pipeline = "menu"
        else:
            pipeline = "unknown"

        dest_key = f"generated/{src_key}"
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        tagging = f"source=generated&generated_date={today}&pipeline={pipeline}"

        # Read source object metadata to get user_id (set by pdf_generator)
        user_id = ""
        try:
            head = s3.head_object(Bucket=src_bucket, Key=src_key)
            user_id = head.get("Metadata", {}).get("user_id", "")
        except Exception as e:
            logger.warning("Failed to read metadata from source object: %s", e)

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

        # Write .metadata.json sidecar so Bedrock KB indexes user_id as a filterable attribute
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
