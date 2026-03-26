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

METADATA_TABLE = os.environ.get("METADATA_TABLE", "")
IMAGES_BUCKET = os.environ.get("IMAGES_BUCKET", "")


def _get_image_history(session_id: str, limit: int) -> str:
    """Query DynamoDB for image generation history for a session."""
    table = dynamodb.Table(METADATA_TABLE)

    response = table.query(
        KeyConditionExpression=Key("PK").eq(f"session#{session_id}") & Key("SK").begins_with("image#"),
        ScanIndexForward=False,  # newest first
        Limit=limit,
    )

    items = response.get("Items", [])
    images = []

    for item in items:
        image_entry = {
            "image_id": item.get("SK", "").replace("image#", ""),
            "type": item.get("type", "image"),
            "prompt": item.get("prompt", item.get("edit_prompt", "")),
            "style": item.get("style", ""),
            "width": item.get("width"),
            "height": item.get("height"),
            "edit_type": item.get("edit_type"),
            "created_at": item.get("created_at", ""),
            "s3_key": item.get("s3_key", ""),
        }

        # Generate fresh presigned URL if we have the S3 key
        s3_key = item.get("s3_key", "")
        if s3_key and IMAGES_BUCKET:
            try:
                presigned_url = s3_client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": IMAGES_BUCKET, "Key": s3_key},
                    ExpiresIn=3600,
                )
                image_entry["image_url"] = presigned_url
            except Exception as e:
                logger.warning(f"Failed to generate presigned URL for {s3_key}: {e}")
                image_entry["image_url"] = None

        images.append(image_entry)

    return json.dumps(
        {
            "session_id": session_id,
            "images": images,
            "count": len(images),
        }
    )


def handler(event, context):
    """
    Nova Canvas image history tool Lambda handler.

    Queries DynamoDB for image generation history within a session,
    returning metadata and fresh presigned URLs for each image.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name == "nova_canvas_history":
            session_id = event.get("session_id", "")
            limit = event.get("limit", 10)

            if not session_id:
                return {"error": "Missing required parameter: session_id"}

            if not METADATA_TABLE:
                return {"error": "METADATA_TABLE environment variable not configured"}

            result = _get_image_history(session_id, limit)
            return {"content": [{"type": "text", "text": result}]}
        else:
            return {"error": f"This Lambda only supports 'nova_canvas_history', received: {tool_name}"}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
