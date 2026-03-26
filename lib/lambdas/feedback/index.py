# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Feedback API Lambda handler — stores user feedback in DynamoDB."""

import os
import uuid
from datetime import datetime

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.event_handler import APIGatewayRestResolver, CORSConfig
from aws_lambda_powertools.logging import correlation_paths

logger = Logger()
tracer = Tracer()

TABLE_NAME = os.environ.get("TABLE_NAME", "")
CORS_ALLOWED_ORIGINS = os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:3000")

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
    feedback_text = body.get("feedbackText", "")
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
        "timestamp": int(datetime.utcnow().timestamp()),
        "createdAt": datetime.utcnow().isoformat(),
    }

    table.put_item(Item=item)
    logger.info("Feedback stored", extra={"feedbackId": item["feedbackId"]})

    return {"feedbackId": item["feedbackId"], "status": "stored"}


@logger.inject_lambda_context(correlation_id_path=correlation_paths.API_GATEWAY_REST)
@tracer.capture_lambda_handler
def handler(event, context):
    """Lambda entry point."""
    return app.resolve(event, context)
