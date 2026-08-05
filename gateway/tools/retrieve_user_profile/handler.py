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
METADATA_TABLE = os.environ.get("METADATA_TABLE", "")


def _recent_accounts(user_id: str, limit: int = 10) -> list[dict]:
    """Applications this caller has opened, newest first.

    Without this nothing could read back an account the Client Advisor had just
    created: place_order writes the record, and no tool returned it. The
    Relationship Manager would ask the knowledge base — which holds reports, not
    accounts — and truthfully say it had never heard of it.

    Read from the metadata table rather than the customers table, because that is
    where an application is written. The customers table holds seeded demo
    profiles keyed by customerId and does not contain the signed-in Cognito
    subject, which is why a profile lookup alone reports nothing for a real user.
    """
    if not METADATA_TABLE:
        return []
    try:
        response = dynamodb.Table(METADATA_TABLE).query(
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={":pk": f"user#{user_id}", ":sk": "order#"},
            ScanIndexForward=False,  # SK carries an ISO timestamp
            Limit=limit,
        )
    except ClientError as e:
        logger.warning("Could not read accounts for %s: %s", user_id, e)
        return []

    return [
        {
            "orderId": item.get("orderId", ""),
            "products": [i.get("name", "") for i in item.get("items", []) or []],
            "status": item.get("status", ""),
            "openedAt": item.get("timestamp", ""),
            "applicantName": item.get("guestName", ""),
        }
        for item in response.get("Items", [])
    ]


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
                    "accounts": _recent_accounts(user_id),
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

        accounts = _recent_accounts(user_id)
        return json.dumps(
            {
                "found": False,
                "user_id": user_id,
                # A caller with no seeded profile may still have opened accounts
                # in this session — the normal case for a real signed-in user —
                # so report those rather than only that no profile exists.
                "accounts": accounts,
                "message": (
                    f"No stored profile for user: {user_id}. {len(accounts)} account application(s) on record."
                ),
            },
            cls=DecimalEncoder,
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
