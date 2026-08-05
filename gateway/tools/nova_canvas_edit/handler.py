# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import base64
import json
import logging
import os
import uuid
from datetime import datetime
from urllib.parse import urlparse

import boto3
import requests

logger = logging.getLogger()
logger.setLevel(logging.INFO)

bedrock_runtime = boto3.client(
    "bedrock-runtime",
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
)
s3_client = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
dynamodb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "us-east-1"))

IMAGES_BUCKET = os.environ.get("IMAGES_BUCKET", "")
METADATA_TABLE = os.environ.get("METADATA_TABLE", "")
NOVA_CANVAS_MODEL_ID = os.environ.get("NOVA_CANVAS_MODEL_ID", "amazon.nova-canvas-v1:0")

# Map edit types to Nova Canvas task types
EDIT_TYPE_MAP = {
    "inpainting": "INPAINTING",
    "outpainting": "OUTPAINTING",
    "background_removal": "BACKGROUND_REMOVAL",
    "variation": "IMAGE_VARIATION",
}


def _download_image_as_base64(image_url: str) -> str:
    """Download an image from a URL and return as base64 string."""
    # Check if it is an S3 presigned URL or regular URL
    parsed = urlparse(image_url)

    if "s3" in parsed.hostname or "amazonaws.com" in parsed.hostname:
        # For S3 URLs, download directly
        response = requests.get(image_url, timeout=300)
        response.raise_for_status()
        return base64.b64encode(response.content).decode("utf-8")
    else:
        response = requests.get(image_url, timeout=300)
        response.raise_for_status()
        return base64.b64encode(response.content).decode("utf-8")


def _edit_image(image_url: str, edit_prompt: str, edit_type: str, session_id: str, user_id: str) -> str:
    """Edit an image using Amazon Nova Canvas."""
    # Download source image
    source_image_b64 = _download_image_as_base64(image_url)

    # Determine task type
    task_type = EDIT_TYPE_MAP.get(edit_type, "INPAINTING")

    # Build request based on edit type
    if task_type == "BACKGROUND_REMOVAL":
        request_payload = {
            "taskType": task_type,
            "backgroundRemovalParams": {
                "image": {"source": {"bytes": source_image_b64}},
            },
        }
    elif task_type == "IMAGE_VARIATION":
        request_payload = {
            "taskType": task_type,
            "imageVariationParams": {
                "text": edit_prompt,
                "images": [source_image_b64],
                "similarityStrength": 0.7,
            },
            "imageGenerationConfig": {
                "numberOfImages": 1,
                "quality": "premium",
            },
        }
    elif task_type == "OUTPAINTING":
        request_payload = {
            "taskType": task_type,
            "outPaintingParams": {
                "text": edit_prompt,
                "image": {"source": {"bytes": source_image_b64}},
                "outPaintingMode": "DEFAULT",
            },
            "imageGenerationConfig": {
                "numberOfImages": 1,
                "quality": "premium",
            },
        }
    else:
        # Default: INPAINTING
        request_payload = {
            "taskType": task_type,
            "inPaintingParams": {
                "text": edit_prompt,
                "image": {"source": {"bytes": source_image_b64}},
            },
            "imageGenerationConfig": {
                "numberOfImages": 1,
                "quality": "premium",
            },
        }

    logger.info(f"Editing image with Nova Canvas ({task_type}): {edit_prompt[:100]}...")

    response = bedrock_runtime.invoke_model(
        modelId=NOVA_CANVAS_MODEL_ID,
        body=json.dumps(request_payload),
        contentType="application/json",
        accept="application/json",
    )

    response_body = json.loads(response["body"].read().decode("utf-8"))

    # Extract image data
    image_data = None
    if "images" in response_body and len(response_body["images"]) > 0:
        image_data = response_body["images"][0]
    elif "image" in response_body:
        image_data = response_body["image"]

    if not image_data:
        raise ValueError("No edited image in response")

    # Upload result to S3
    image_bytes = base64.b64decode(image_data)
    image_id = str(uuid.uuid4())[:8]
    s3_key = f"images/{session_id}/{image_id}-edited.png"

    s3_client.put_object(
        Bucket=IMAGES_BUCKET,
        Key=s3_key,
        Body=image_bytes,
        ContentType="image/png",
    )

    presigned_url = s3_client.generate_presigned_url(
        "get_object",
        Params={"Bucket": IMAGES_BUCKET, "Key": s3_key},
        ExpiresIn=3600,
    )

    # Store metadata
    if METADATA_TABLE:
        try:
            table = dynamodb.Table(METADATA_TABLE)
            created_at = datetime.utcnow().isoformat()
            table.put_item(
                Item={
                    # Keyed by the verified caller — see nova_canvas_generate for
                    # why session_id cannot be the partition.
                    "PK": f"user#{user_id}",
                    "SK": f"image#{created_at}#{image_id}",
                    "imageId": image_id,
                    "sessionId": session_id,
                    "type": "image_edit",
                    "edit_type": edit_type,
                    "edit_prompt": edit_prompt,
                    "source_url": image_url,
                    "s3_key": s3_key,
                    "user_id": user_id,
                    "created_at": created_at,
                    "ttl": int(datetime.utcnow().timestamp()) + 604800,
                }
            )
        except Exception as e:
            logger.warning(f"Failed to store edit metadata: {e}")

    return json.dumps(
        {
            "success": True,
            "image_url": presigned_url,
            "image_id": image_id,
            "edit_type": edit_type,
            "s3_key": s3_key,
            "metadata": {
                "edit_prompt": edit_prompt,
                "edit_type": edit_type,
                "model": NOVA_CANVAS_MODEL_ID,
            },
        }
    )


def handler(event, context):
    """
    Nova Canvas image editing tool Lambda handler.

    Edits existing images using Amazon Nova Canvas with support for
    inpainting, outpainting, background removal, and image variations.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name == "nova_canvas_edit":
            image_url = event.get("image_url", "")
            edit_prompt = event.get("edit_prompt", "")
            edit_type = event.get("edit_type", "inpainting")
            session_id = event.get("session_id", str(uuid.uuid4())[:8])
            user_id = event.get("user_id", "")

            if not image_url:
                return {"error": "Missing required parameter: image_url"}
            if not edit_prompt and edit_type != "background_removal":
                return {
                    "error": "Missing required parameter: edit_prompt (required unless edit_type is background_removal)"
                }
            # The record is partitioned by the caller, so an absent user_id would
            # file the edit under user# where nothing can find it again.
            if not user_id:
                return {"error": "Missing user_id — runtime hook not wired."}

            if not IMAGES_BUCKET:
                return {"error": "IMAGES_BUCKET environment variable not configured"}

            result = _edit_image(image_url, edit_prompt, edit_type, session_id, user_id)
            return {"content": [{"type": "text", "text": result}]}
        else:
            return {"error": f"This Lambda only supports 'nova_canvas_edit', received: {tool_name}"}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
