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

s3_client = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
dynamodb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "us-east-1"))

IMAGES_BUCKET = os.environ.get("IMAGES_BUCKET", "")
METADATA_TABLE = os.environ.get("METADATA_TABLE", "")

# Text-to-image model. Amazon Nova Canvas (the former default) is marked LEGACY
# and Bedrock refuses it in an account that has not invoked it for 30 days. The
# active text-to-image models are Stability's Stable Image / SD3.5 family, which
# in this account are available in us-west-2 (not us-east-1) — hence a dedicated
# cross-region Bedrock client. Overridable via env for a future swap.
IMAGE_MODEL_ID = os.environ.get("IMAGE_MODEL_ID", "stability.sd3-5-large-v1:0")
IMAGE_MODEL_REGION = os.environ.get("IMAGE_MODEL_REGION", "us-west-2")

bedrock_runtime = boto3.client("bedrock-runtime", region_name=IMAGE_MODEL_REGION)

# Aspect ratios Stable Image / SD3.5 accept (they take an aspect_ratio, not
# arbitrary width/height). We map the requested dimensions to the nearest one.
_STABILITY_ASPECT_RATIOS = {
    "1:1": 1.0,
    "16:9": 16 / 9,
    "9:16": 9 / 16,
    "3:2": 3 / 2,
    "2:3": 2 / 3,
    "4:5": 4 / 5,
    "5:4": 5 / 4,
    "21:9": 21 / 9,
    "9:21": 9 / 21,
}


def _nearest_aspect_ratio(width: int, height: int) -> str:
    """Map requested width/height to the closest aspect ratio Stability accepts."""
    if not width or not height:
        return "1:1"
    target = width / height
    return min(_STABILITY_ASPECT_RATIOS, key=lambda k: abs(_STABILITY_ASPECT_RATIOS[k] - target))


# Diffusion models render lettering as plausible-looking gibberish — a catalog
# image came back reading "Trinity M?naged / SOTEROIAFLI OEN MANCIA fadSTB". Since
# every caller here wants clean product imagery with captions supplied by the PDF
# and web templates, text is suppressed centrally rather than trusting each
# prompt to remember.
NO_TEXT_NEGATIVE = (
    "text, words, letters, lettering, typography, captions, labels, watermark, "
    "signature, logo, brand name, numbers, writing, subtitles"
)


def _generate_image(
    prompt: str,
    width: int,
    height: int,
    style: str,
    negative_prompt: str,
    session_id: str,
    user_id: str,
) -> str:
    """Generate an image using a Stability text-to-image model and save to S3."""
    # Style is folded into the prompt (Stable Image has no separate style param).
    text = f"{prompt}, {style} style" if style else prompt

    # Stable Image / SD3.5 request schema (differs from Nova Canvas): a flat
    # prompt with an aspect_ratio rather than explicit width/height.
    request_payload = {
        "prompt": text,
        "mode": "text-to-image",
        "aspect_ratio": _nearest_aspect_ratio(width, height),
        "output_format": "png",
    }
    # Always suppress text, keeping any caller-supplied terms as well.
    request_payload["negative_prompt"] = (
        f"{negative_prompt}, {NO_TEXT_NEGATIVE}" if negative_prompt else NO_TEXT_NEGATIVE
    )

    logger.info(f"Generating image with {IMAGE_MODEL_ID} ({IMAGE_MODEL_REGION}): {prompt[:100]}...")

    response = bedrock_runtime.invoke_model(
        modelId=IMAGE_MODEL_ID,
        body=json.dumps(request_payload),
        contentType="application/json",
        accept="application/json",
    )

    response_body = json.loads(response["body"].read().decode("utf-8"))

    # Stable Image returns {"images": [b64], "seeds": [...], "finish_reasons": [...]}.
    # A non-null finish_reason means the image was filtered (e.g. by content
    # moderation) and no usable image was returned.
    finish_reasons = response_body.get("finish_reasons") or []
    if finish_reasons and finish_reasons[0]:
        raise RuntimeError(
            f"Image generation was filtered by the model (reason: {finish_reasons[0]}). Try rephrasing the prompt."
        )

    images = response_body.get("images") or []
    image_data = images[0] if images else response_body.get("image")

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
                "model": IMAGE_MODEL_ID,
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
