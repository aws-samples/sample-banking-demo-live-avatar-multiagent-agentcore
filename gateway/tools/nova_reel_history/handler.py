# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging
import os

import boto3
from boto3.dynamodb.conditions import Key

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "us-east-1"))
s3_client = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
bedrock_runtime = boto3.client(
    "bedrock-runtime",
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
)

METADATA_TABLE = os.environ.get("METADATA_TABLE", "")
VIDEOS_BUCKET = os.environ.get("VIDEOS_BUCKET", os.environ.get("IMAGES_BUCKET", ""))


def _get_video_history(session_id: str, limit: int) -> str:
    """Query DynamoDB for video generation history for a session."""
    table = dynamodb.Table(METADATA_TABLE)

    response = table.query(
        KeyConditionExpression=Key("PK").eq(f"session#{session_id}") & Key("SK").begins_with("video#"),
        ScanIndexForward=False,  # newest first
        Limit=limit,
    )

    items = response.get("Items", [])
    videos = []

    for item in items:
        video_entry = {
            "video_id": item.get("SK", "").replace("video#", ""),
            "prompt": item.get("prompt", ""),
            "duration_seconds": item.get("duration_seconds"),
            "status": item.get("status", "Unknown"),
            "invocation_arn": item.get("invocation_arn", ""),
            "created_at": item.get("created_at", ""),
        }

        # If job completed, try to get a fresh presigned URL
        invocation_arn = item.get("invocation_arn", "")
        if invocation_arn:
            try:
                status_response = bedrock_runtime.get_async_invoke(invocationArn=invocation_arn)
                current_status = status_response.get("status", "Unknown")
                video_entry["status"] = current_status

                if current_status == "Completed":
                    s3_output = status_response.get("outputDataConfig", {}).get("s3OutputDataConfig", {})
                    s3_uri = s3_output.get("s3Uri", "")
                    if s3_uri:
                        s3_parts = s3_uri.replace("s3://", "").split("/", 1)
                        bucket = s3_parts[0]
                        prefix = s3_parts[1] if len(s3_parts) > 1 else ""

                        list_response = s3_client.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=10)
                        for obj in list_response.get("Contents", []):
                            key = obj["Key"]
                            if key.endswith(".mp4") or key.endswith(".webm"):
                                presigned_url = s3_client.generate_presigned_url(
                                    "get_object",
                                    Params={"Bucket": bucket, "Key": key},
                                    ExpiresIn=3600,
                                )
                                video_entry["video_url"] = presigned_url
                                break
            except Exception as e:
                logger.warning(f"Failed to refresh video status for {invocation_arn}: {e}")

        videos.append(video_entry)

    return json.dumps(
        {
            "session_id": session_id,
            "videos": videos,
            "count": len(videos),
        }
    )


def handler(event, context):
    """
    Nova Reel video history tool Lambda handler.

    Queries DynamoDB for video generation history within a session,
    refreshes job statuses, and returns metadata with fresh presigned URLs.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name == "nova_reel_history":
            session_id = event.get("session_id", "")
            limit = event.get("limit", 10)

            if not session_id:
                return {"error": "Missing required parameter: session_id"}

            if not METADATA_TABLE:
                return {"error": "METADATA_TABLE environment variable not configured"}

            result = _get_video_history(session_id, limit)
            return {"content": [{"type": "text", "text": result}]}
        else:
            return {"error": f"This Lambda only supports 'nova_reel_history', received: {tool_name}"}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
