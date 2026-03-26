# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging
import os
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "us-east-1"))
CUSTOMERS_TABLE = os.environ.get("CUSTOMERS_TABLE", os.environ.get("DYNAMODB_TABLE_NAME", ""))


class DecimalEncoder(json.JSONEncoder):
    """Handle Decimal types from DynamoDB."""

    def default(self, obj):
        if isinstance(obj, Decimal):
            if obj % 1 == 0:
                return int(obj)
            return float(obj)
        return super().default(obj)


def _retrieve_profile(user_id: str) -> str:
    """Look up a user profile in DynamoDB."""
    table = dynamodb.Table(CUSTOMERS_TABLE)

    try:
        # Try lookup by customerId as primary key (matches DynamoDB table PK)
        response = table.get_item(Key={"customerId": user_id})

        if "Item" in response:
            profile = response["Item"]
            return json.dumps(
                {
                    "found": True,
                    "user_id": user_id,
                    "profile": profile,
                },
                cls=DecimalEncoder,
            )

        # If not found by user_id, try phone_number as key (legacy support)
        clean_id = user_id.replace("-", "").strip()
        if clean_id.isdigit():
            response = table.get_item(Key={"phone_number": clean_id})
            if "Item" in response:
                profile = response["Item"]
                return json.dumps(
                    {
                        "found": True,
                        "user_id": user_id,
                        "lookup_key": "phone_number",
                        "profile": profile,
                    },
                    cls=DecimalEncoder,
                )

        return json.dumps(
            {
                "found": False,
                "user_id": user_id,
                "message": f"No profile found for user: {user_id}",
            }
        )

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "ResourceNotFoundException":
            return json.dumps(
                {
                    "found": False,
                    "user_id": user_id,
                    "error": f"Table '{CUSTOMERS_TABLE}' not found",
                }
            )
        raise


def handler(event, context):
    """
    User profile retrieval tool Lambda handler.

    Queries DynamoDB for a user profile by user_id or phone_number.
    Returns the full profile data or a not-found message.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name == "retrieve_user_profile":
            user_id = event.get("user_id", "")

            if not user_id:
                return {"error": "Missing required parameter: user_id"}

            if not CUSTOMERS_TABLE:
                return {"error": "CUSTOMERS_TABLE (or DYNAMODB_TABLE_NAME) environment variable not configured"}

            result = _retrieve_profile(user_id)
            return {"content": [{"type": "text", "text": result}]}
        else:
            return {"error": f"This Lambda only supports 'retrieve_user_profile', received: {tool_name}"}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
