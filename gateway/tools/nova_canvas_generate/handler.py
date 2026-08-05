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
s3_client = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
dynamodb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "us-east-1"))

IMAGES_BUCKET = os.environ.get("IMAGES_BUCKET", "")
METADATA_TABLE = os.environ.get("METADATA_TABLE", "")
NOVA_CANVAS_MODEL_ID = os.environ.get("NOVA_CANVAS_MODEL_ID", "amazon.nova-canvas-v1:0")


def _generate_image(
    prompt: str,
    width: int,
    height: int,
    style: str,
    negative_prompt: str,
    session_id: str,
    user_id: str,
) -> str:
    """Generate an image using Amazon Nova Canvas and save to S3."""
    # Build request payload
    request_payload = {
        "taskType": "TEXT_IMAGE",
        "textToImageParams": {
            "text": prompt,
        },
        "imageGenerationConfig": {
            "width": width,
            "height": height,
            "numberOfImages": 1,
            "quality": "premium",
            "cfgScale": 7.5,
        },
    }

    # Add negative prompt if provided
    if negative_prompt:
        request_payload["textToImageParams"]["negativeText"] = negative_prompt

    # Append style to prompt text if provided (style parameter has API issues)
    if style:
        request_payload["textToImageParams"]["text"] = f"{prompt}, {style} style"

    logger.info(f"Generating image with Nova Canvas: {prompt[:100]}...")

    # Invoke the model.
    #
    # Nova Canvas is marked LEGACY by the provider. Bedrock refuses it outright
    # in an account that has not invoked it for 30 days, with a
    # ResourceNotFoundException whose message is easy to mistake for a missing
    # resource or a typo in the model id. There is no drop-in replacement: as of
    # Aug 2026 this account has no other text-to-image model (Titan Image is
    # end-of-life, the Stability text-to-image ids are unavailable, and every
    # active Stability model requires an input image). Re-enabling access is a
    # console/support action, so the error is translated into something the
    # operator can act on rather than left opaque.
    try:
        response = bedrock_runtime.invoke_model(
            modelId=NOVA_CANVAS_MODEL_ID,
            body=json.dumps(request_payload),
            contentType="application/json",
            accept="application/json",
        )
    except bedrock_runtime.exceptions.ResourceNotFoundException as e:
        message = str(e)
        if "Legacy" in message or "legacy" in message:
            raise RuntimeError(
                f"Image generation unavailable: Bedrock is refusing {NOVA_CANVAS_MODEL_ID} "
                "because it is marked LEGACY and this account has not invoked it in the last "
                "30 days. Re-enable access for the model in the Bedrock console (Model access), "
                "or set NOVA_CANVAS_MODEL_ID to a text-to-image model this account can invoke. "
                "Verify with: aws bedrock list-foundation-models --by-output-modality IMAGE"
            ) from e
        raise

    response_body = json.loads(response["body"].read().decode("utf-8"))

    # Extract image data from response
    image_data = None
    if "images" in response_body and len(response_body["images"]) > 0:
        image_data = response_body["images"][0]
    elif "image" in response_body:
        image_data = response_body["image"]

    if not image_data:
        raise ValueError("No image generated in response")

    # Upload to S3
    import base64

    image_bytes = base64.b64decode(image_data)
    image_id = str(uuid.uuid4())[:8]
    s3_key = f"images/{session_id}/{image_id}.png"

    s3_client.put_object(
        Bucket=IMAGES_BUCKET,
        Key=s3_key,
        Body=image_bytes,
        ContentType="image/png",
    )

    # Generate presigned URL
    presigned_url = s3_client.generate_presigned_url(
        "get_object",
        Params={"Bucket": IMAGES_BUCKET, "Key": s3_key},
        ExpiresIn=3600,
    )

    # Store metadata in DynamoDB
    if METADATA_TABLE:
        try:
            table = dynamodb.Table(METADATA_TABLE)
            created_at = datetime.utcnow().isoformat()
            table.put_item(
                Item={
                    # Partitioned by the verified caller, not by session_id.
                    # session_id is supplied by the model and defaults to a fresh
                    # uuid that is never returned, so anything written under
                    # PK=session#{session_id} was unreachable: nova_canvas_history
                    # had no way to name the partition. Keying on the caller also
                    # removes a cross-user read, since the old history query
                    # trusted whatever session id it was handed.
                    "PK": f"user#{user_id}",
                    "SK": f"image#{created_at}#{image_id}",
                    "imageId": image_id,
                    "sessionId": session_id,
                    "type": "image",
                    "prompt": prompt,
                    "style": style or "none",
                    "width": width,
                    "height": height,
                    "s3_key": s3_key,
                    "user_id": user_id,
                    "created_at": created_at,
                    "ttl": int(datetime.utcnow().timestamp()) + 604800,  # 7 days
                }
            )
        except Exception as e:
            logger.warning(f"Failed to store image metadata: {e}")

    return json.dumps(
        {
            "success": True,
            "image_url": presigned_url,
            "image_id": image_id,
            "s3_key": s3_key,
            "metadata": {
                "prompt": prompt,
                "style": style,
                "width": width,
                "height": height,
                "model": NOVA_CANVAS_MODEL_ID,
            },
        }
    )


def handler(event, context):
    """
    Nova Canvas image generation tool Lambda handler.

    Generates images using Amazon Nova Canvas, uploads them to S3,
    and returns a presigned URL. Stores metadata in DynamoDB.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name == "nova_canvas_generate":
            prompt = event.get("prompt", "")
            width = event.get("width", 512)
            height = event.get("height", 512)
            style = event.get("style", "")
            negative_prompt = event.get("negative_prompt", "")
            session_id = event.get("session_id", str(uuid.uuid4())[:8])
            user_id = event.get("user_id", "")

            if not prompt:
                return {"error": "Missing required parameter: prompt"}
            # The record is partitioned by the caller, so an absent user_id would
            # file the image under user# where nothing can find it again.
            if not user_id:
                return {"error": "Missing user_id — runtime hook not wired."}

            if not IMAGES_BUCKET:
                return {"error": "IMAGES_BUCKET environment variable not configured"}

            result = _generate_image(prompt, width, height, style, negative_prompt, session_id, user_id)
            return {"content": [{"type": "text", "text": result}]}
        else:
            return {"error": f"This Lambda only supports 'nova_canvas_generate', received: {tool_name}"}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
