# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""KB Reset Lambda — purge generated PDFs and re-index the Knowledge Base."""

import os

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.event_handler import APIGatewayRestResolver, CORSConfig
from aws_lambda_powertools.logging import correlation_paths

logger = Logger()
tracer = Tracer()

KB_DOCS_BUCKET = os.environ.get("KB_DOCS_BUCKET", "")
KNOWLEDGE_BASE_ID = os.environ.get("KNOWLEDGE_BASE_ID", "")
DATA_SOURCE_ID = os.environ.get("DATA_SOURCE_ID", "")
CORS_ALLOWED_ORIGINS = os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:3000")

cors_config = CORSConfig(
    allow_origin=CORS_ALLOWED_ORIGINS.split(",")[0],
    allow_headers=["Content-Type", "Authorization"],
    max_age=300,
    extra_origins=CORS_ALLOWED_ORIGINS.split(",")[1:],
)
app = APIGatewayRestResolver(cors=cors_config)

s3 = boto3.client("s3")
bedrock_agent = boto3.client("bedrock-agent")


@app.post("/kb-reset")
@tracer.capture_method
def reset_kb():
    """Delete generated/ objects from KB docs bucket and start re-ingestion."""
    if not KB_DOCS_BUCKET or not KNOWLEDGE_BASE_ID or not DATA_SOURCE_ID:
        return {"statusCode": 500, "body": "KB environment not configured"}

    # List all objects under generated/ prefix
    prefix = "generated/"
    paginator = s3.get_paginator("list_objects_v2")
    objects = []
    for page in paginator.paginate(Bucket=KB_DOCS_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            objects.append({"Key": obj["Key"]})

    deleted_count = 0
    if objects:
        # Batch delete (max 1000 per call)
        for i in range(0, len(objects), 1000):
            batch = objects[i : i + 1000]
            s3.delete_objects(
                Bucket=KB_DOCS_BUCKET,
                Delete={"Objects": batch, "Quiet": True},
            )
            deleted_count += len(batch)

    logger.info("Deleted generated objects", extra={"count": deleted_count})

    # Start fresh ingestion job
    response = bedrock_agent.start_ingestion_job(
        knowledgeBaseId=KNOWLEDGE_BASE_ID,
        dataSourceId=DATA_SOURCE_ID,
    )

    job_id = response["ingestionJob"]["ingestionJobId"]
    logger.info("Ingestion job started", extra={"jobId": job_id})

    return {
        "deletedCount": deleted_count,
        "ingestionJobId": job_id,
        "status": "ingestion_started",
    }


@logger.inject_lambda_context(correlation_id_path=correlation_paths.API_GATEWAY_REST)
@tracer.capture_lambda_handler
def handler(event, context):
    """Lambda entry point."""
    return app.resolve(event, context)
