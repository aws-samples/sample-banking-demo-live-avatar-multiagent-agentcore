"""
Place order tool -- writes a restaurant order to DynamoDB metadata table.
"""

import json
import logging
import os
import uuid
from datetime import datetime

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource("dynamodb")
METADATA_TABLE = os.environ.get("METADATA_TABLE", "")


def handler(event, context):
    """Place a restaurant order.

    Requires `user_id` in the event (injected by UserScopeHook at the
    runtime layer). The DynamoDB item is keyed by order_id but also carries
    `customerId` so order lookups can be scoped per-user by future readers.
    """
    try:
        logger.info("Received event: %s", json.dumps(event))

        user_id = event.get("user_id", "")
        items = event.get("items", [])
        special_instructions = event.get("special_instructions", "")
        guest_name = event.get("guest_name", "Guest")
        table_number = event.get("table_number", "")

        if not user_id:
            return {"content": [{"type": "text", "text": "Missing user_id — runtime hook not wired."}]}

        if not items:
            return {"content": [{"type": "text", "text": "No items specified in the order."}]}

        if not METADATA_TABLE:
            return {"content": [{"type": "text", "text": "Order system is not configured."}]}

        order_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat()

        table = dynamodb.Table(METADATA_TABLE)
        table.put_item(
            Item={
                "PK": f"order#{order_id}",
                "SK": f"placed#{timestamp}",
                "orderId": order_id,
                "customerId": user_id,
                "items": items,
                "specialInstructions": special_instructions,
                "guestName": guest_name,
                "tableNumber": table_number,
                "status": "received",
                "timestamp": timestamp,
                "ttl": int(datetime.utcnow().timestamp()) + 86400,  # 24h TTL
            }
        )

        order_summary = {
            "orderId": order_id,
            "status": "received",
            "items": items,
            "message": f"Order {order_id} placed successfully for {guest_name}.",
        }

        if special_instructions:
            order_summary["specialInstructions"] = special_instructions

        return {"content": [{"type": "text", "text": json.dumps(order_summary, indent=2)}]}

    except Exception as e:
        logger.error("Order placement error: %s", str(e))
        return {"content": [{"type": "text", "text": f"Failed to place order: {str(e)}"}]}
