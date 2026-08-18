"""
Open account tool -- writes an account application / service enrollment to the
DynamoDB metadata table. A synthetic banking application intake for the Trinity
Reserve Bank demo (no real PII is ever requested or stored).
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
    """Submit a synthetic account application / service enrollment.

    Requires `user_id` in the event (injected by UserScopeHook at the runtime
    layer). The DynamoDB item is partitioned by the caller (PK=user#{user_id})
    with an `application#{timestamp}#{id}` sort key, so retrieve_user_profile can
    list one user's applications with a single query — no scan, no cross-user
    read.
    """
    try:
        logger.info("Received event: %s", json.dumps(event))

        user_id = event.get("user_id", "")
        products = event.get("products", [])
        notes = event.get("notes", "")
        applicant_name = event.get("applicant_name", "Applicant")

        if not user_id:
            return {"content": [{"type": "text", "text": "Missing user_id — runtime hook not wired."}]}

        if not products:
            return {"content": [{"type": "text", "text": "No products specified in the application."}]}

        if not METADATA_TABLE:
            return {"content": [{"type": "text", "text": "Application system is not configured."}]}

        application_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat()

        table = dynamodb.Table(METADATA_TABLE)
        table.put_item(
            Item={
                "PK": f"user#{user_id}",
                "SK": f"application#{timestamp}#{application_id}",
                "applicationId": application_id,
                "customerId": user_id,
                "products": products,
                "notes": notes,
                "applicantName": applicant_name,
                "status": "received",
                "timestamp": timestamp,
                "ttl": int(datetime.utcnow().timestamp()) + 86400,  # 24h TTL
            }
        )

        application_summary = {
            "applicationId": application_id,
            "status": "received",
            "products": products,
            "message": f"Application {application_id} submitted successfully for {applicant_name}.",
        }

        if notes:
            application_summary["notes"] = notes

        return {"content": [{"type": "text", "text": json.dumps(application_summary, indent=2)}]}

    except Exception as e:
        logger.error("Account application error: %s", str(e))
        return {"content": [{"type": "text", "text": f"Failed to submit application: {str(e)}"}]}
