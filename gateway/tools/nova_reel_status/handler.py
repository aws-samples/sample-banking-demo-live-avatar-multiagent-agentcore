# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging
import os

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

bedrock_runtime = boto3.client(
    "bedrock-runtime",
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
)
s3_client = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))

VIDEOS_BUCKET = os.environ.get("VIDEOS_BUCKET", os.environ.get("IMAGES_BUCKET", ""))


def _check_video_status(invocation_arn: str) -> str:
    """Check the status of an async video generation job."""
    response = bedrock_runtime.get_async_invoke(invocationArn=invocation_arn)

    status = response.get("status", "Unknown")
    output_config = response.get("outputDataConfig", {})
    s3_output = output_config.get("s3OutputDataConfig", {})
    s3_uri = s3_output.get("s3Uri", "")

    result = {
        "invocation_arn": invocation_arn,
        "status": status,
    }

    if status == "Completed" and s3_uri:
        # Try to generate a presigned URL for the video
        # The video file is typically at {s3_uri}/output.mp4
        try:
            # Parse the S3 URI
            s3_parts = s3_uri.replace("s3://", "").split("/", 1)
            bucket = s3_parts[0]
            prefix = s3_parts[1] if len(s3_parts) > 1 else ""

            # List objects to find the video file
            list_response = s3_client.list_objects_v2(
                Bucket=bucket,
                Prefix=prefix,
                MaxKeys=10,
            )

            video_key = None
            for obj in list_response.get("Contents", []):
                key = obj["Key"]
                if key.endswith(".mp4") or key.endswith(".webm"):
                    video_key = key
                    break

            if video_key:
                presigned_url = s3_client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": bucket, "Key": video_key},
                    ExpiresIn=3600,
                )
                result["video_url"] = presigned_url
                result["s3_key"] = video_key
            else:
                result["s3_output_uri"] = s3_uri
                result["message"] = "Video completed but output file not found at expected location"

        except Exception as e:
            logger.warning(f"Failed to generate presigned URL: {e}")
            result["s3_output_uri"] = s3_uri
            result["message"] = "Video completed. Check S3 output location for the file."

    elif status == "InProgress":
        result["message"] = "Video generation is still in progress. Check again in 30-60 seconds."

    elif status == "Failed":
        failure_message = response.get("failureMessage", "Unknown failure")
        result["error"] = failure_message
        result["message"] = f"Video generation failed: {failure_message}"

    return json.dumps(result)


def handler(event, context):
    """
    Nova Reel video status tool Lambda handler.

    Checks the status of an asynchronous video generation job by invocation ARN.
    Returns the status and a presigned URL if the video is complete.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name == "nova_reel_status":
            invocation_arn = event.get("invocation_arn", "")

            if not invocation_arn:
                return {"error": "Missing required parameter: invocation_arn"}

            result = _check_video_status(invocation_arn)
            return {"content": [{"type": "text", "text": result}]}
        else:
            return {"error": f"This Lambda only supports 'nova_reel_status', received: {tool_name}"}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
