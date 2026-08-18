# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging
import os
import uuid
from datetime import datetime

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

bedrock_runtime = boto3.client(
    "bedrock-runtime",
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
)
dynamodb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "us-east-1"))

NOVA_REEL_MODEL_ID = os.environ.get("NOVA_REEL_MODEL_ID", "amazon.nova-reel-v1:0")
VIDEOS_BUCKET = os.environ.get("VIDEOS_BUCKET", os.environ.get("IMAGES_BUCKET", ""))
METADATA_TABLE = os.environ.get("METADATA_TABLE", "")


def _generate_video(prompt: str, duration_seconds: int, session_id: str, user_id: str) -> str:
    """Submit an async video generation job using Amazon Nova Reel."""
    request_id = str(uuid.uuid4())[:8]

    # S3 output location for the generated video
    s3_output_uri = f"s3://{VIDEOS_BUCKET}/videos/{session_id}/{request_id}"

    # Build model input
    model_input = {
        "taskType": "TEXT_VIDEO",
        "textToVideoParams": {
            "text": prompt,
        },
        "videoGenerationConfig": {
            "durationSeconds": min(max(duration_seconds, 6), 120),
            "fps": 24,
            "dimension": "1280x720",
        },
    }

    logger.info(f"Submitting Nova Reel async job: {prompt[:100]}...")

    # Submit async invocation
    response = bedrock_runtime.start_async_invoke(
        modelId=NOVA_REEL_MODEL_ID,
        modelInput=model_input,
        outputDataConfig={
            "s3OutputDataConfig": {
                "s3Uri": s3_output_uri,
            }
        },
    )

    invocation_arn = response.get("invocationArn", "")

    # Store job metadata in DynamoDB
    if METADATA_TABLE:
        try:
            table = dynamodb.Table(METADATA_TABLE)
            created_at = datetime.utcnow().isoformat()
            table.put_item(
                Item={
                    # Keyed by the verified caller — see image_generate for
                    # why session_id cannot be the partition.
                    "PK": f"user#{user_id}",
                    "SK": f"video#{created_at}#{request_id}",
                    "videoId": request_id,
                    "sessionId": session_id,
                    "type": "video",
                    "prompt": prompt,
                    "duration_seconds": duration_seconds,
                    "invocation_arn": invocation_arn,
                    "s3_output_uri": s3_output_uri,
                    "status": "InProgress",
                    "user_id": user_id,
                    "created_at": created_at,
                    "ttl": int(datetime.utcnow().timestamp()) + 604800,  # 7 days
                }
            )
        except Exception as e:
            logger.warning(f"Failed to store video metadata: {e}")

    return json.dumps(
        {
            "success": True,
            "status": "InProgress",
            "invocation_arn": invocation_arn,
            "request_id": request_id,
            "message": f"Video generation job submitted. Use video_status with the invocation_arn to check progress. Estimated time: {duration_seconds * 10}-{duration_seconds * 20} seconds.",
            "metadata": {
                "prompt": prompt,
                "duration_seconds": duration_seconds,
                "model": NOVA_REEL_MODEL_ID,
            },
        }
    )


def handler(event, context):
    """
    Nova Reel video generation tool Lambda handler.

    Submits an asynchronous video generation job using Amazon Nova Reel.
    Returns the job ARN immediately without polling. Use video_status
    to check job progress.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name == "video_generate":
            prompt = event.get("prompt", "")
            duration_seconds = event.get("duration_seconds", 6)
            session_id = event.get("session_id", str(uuid.uuid4())[:8])
            user_id = event.get("user_id", "")

            if not prompt:
                return {"error": "Missing required parameter: prompt"}
            # The record is partitioned by the caller, so an absent user_id would
            # file the job under user# where nothing can find it again.
            if not user_id:
                return {"error": "Missing user_id — runtime hook not wired."}

            if not VIDEOS_BUCKET:
                return {"error": "VIDEOS_BUCKET (or IMAGES_BUCKET) environment variable not configured"}

            result = _generate_video(prompt, duration_seconds, session_id, user_id)
            return {"content": [{"type": "text", "text": result}]}
        else:
            return {"error": f"This Lambda only supports 'video_generate', received: {tool_name}"}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
