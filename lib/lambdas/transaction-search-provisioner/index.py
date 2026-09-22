# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""CDK custom-resource handler that enables CloudWatch Transaction Search.

Transaction Search is the account-level setting that makes AWS X-Ray deliver
trace segments to CloudWatch Logs, which is what creates the shared `aws/spans`
log group. AgentCore batch evaluation reads its sessions out of that group, so
without this the demo's evaluation step fails with:

    ValidationException: Log group 'aws/spans' not found in your account.

There is no CloudFormation resource for it, so this Lambda performs the same
three API calls the console's "Enable Transaction Search" button makes:

  1. logs:PutResourcePolicy  - let xray.amazonaws.com write into aws/spans and
                               /aws/application-signals/data
  2. xray:UpdateTraceSegmentDestination - switch the destination to CloudWatchLogs
  3. xray:UpdateIndexingRule - set the span indexing percentage (1% is free tier)

Ordering matters: step 2 fails with AccessDeniedException ("XRay does not have
permission to call PutLogEvents on the aws/spans Log Group") unless the resource
policy from step 1 is already in place and its ARNs are exactly right.

THIS IS ACCOUNT-LEVEL, SHARED STATE. Three deliberate consequences:

* Read before write. If the destination is already CloudWatchLogs we leave it
  alone, and we never LOWER an existing indexing percentage — another workload in
  the account may have deliberately set it higher.
* Delete does NOT revert. Reverting the destination to XRay on `cdk destroy`
  would silently break Transaction Search for every other application in the
  account. We log the decision and leave the setting enabled.
* Best effort. A deployer whose role cannot change X-Ray settings still gets a
  successful deploy; only the evaluation step is affected, and the app reports
  the missing prerequisite instead of failing opaquely.

The destination goes to PENDING and settles to ACTIVE asynchronously (typically a
few minutes). We do not block the stack waiting for that.
"""

import json
import os

import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "us-east-1")
SPANS_LOG_GROUP = os.environ.get("SPANS_LOG_GROUP", "aws/spans")
APP_SIGNALS_LOG_GROUP = "/aws/application-signals/data"
RESOURCE_POLICY_NAME = os.environ.get("RESOURCE_POLICY_NAME", "TransactionSearchXRayAccess")
# 1% keeps span indexing inside the free tier; raising it only widens Transaction
# Search query coverage, it does not affect whether evaluations can read spans.
INDEXING_PERCENTAGE = float(os.environ.get("INDEXING_PERCENTAGE", "1"))

PHYSICAL_ID = "transaction-search-config"


def _resource_policy_document(account: str) -> str:
    """Policy allowing X-Ray to deliver spans into the two Logs destinations.

    Built with json.dumps rather than string interpolation: the ARNs must be
    byte-exact, and a mangled ARN presents later as an unrelated-looking
    AccessDeniedException from UpdateTraceSegmentDestination.
    """
    return json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "TransactionSearchXRayAccess",
                    "Effect": "Allow",
                    "Principal": {"Service": "xray.amazonaws.com"},
                    "Action": "logs:PutLogEvents",
                    "Resource": [
                        f"arn:aws:logs:{REGION}:{account}:log-group:{SPANS_LOG_GROUP}:*",
                        f"arn:aws:logs:{REGION}:{account}:log-group:{APP_SIGNALS_LOG_GROUP}:*",
                    ],
                    "Condition": {
                        "ArnLike": {"aws:SourceArn": f"arn:aws:xray:{REGION}:{account}:*"},
                        "StringEquals": {"aws:SourceAccount": account},
                    },
                }
            ],
        }
    )


def _enable() -> dict:
    """Enable Transaction Search, skipping whatever is already configured."""
    result = {"ResourcePolicy": "skipped", "Destination": "unchanged", "IndexingPercentage": "unchanged"}

    account = boto3.client("sts", region_name=REGION).get_caller_identity()["Account"]
    logs = boto3.client("logs", region_name=REGION)
    xray = boto3.client("xray", region_name=REGION)

    # 1. Resource policy. Idempotent upsert, and always re-applied so a policy
    #    written by an older/incorrect version of this code is corrected.
    try:
        logs.put_resource_policy(
            policyName=RESOURCE_POLICY_NAME,
            policyDocument=_resource_policy_document(account),
        )
        result["ResourcePolicy"] = "applied"
        print(f"[TXSEARCH] resource policy {RESOURCE_POLICY_NAME} applied")
    except ClientError as exc:
        # Without the policy the destination switch cannot succeed, so stop here
        # rather than reporting a misleading AccessDenied from the next call.
        print(f"[TXSEARCH] put_resource_policy failed, leaving Transaction Search alone: {exc}")
        result["ResourcePolicy"] = f"failed: {exc.response.get('Error', {}).get('Code', 'Unknown')}"
        return result

    # 2. Destination. Read first: if another stack already enabled it, do nothing.
    try:
        current = xray.get_trace_segment_destination()
        if current.get("Destination") == "CloudWatchLogs":
            result["Destination"] = f"already CloudWatchLogs ({current.get('Status')})"
            print(f"[TXSEARCH] destination already CloudWatchLogs ({current.get('Status')})")
        else:
            updated = xray.update_trace_segment_destination(Destination="CloudWatchLogs")
            # Settles PENDING -> ACTIVE asynchronously; we do not wait.
            result["Destination"] = f"set to CloudWatchLogs ({updated.get('Status')})"
            print(f"[TXSEARCH] destination set to CloudWatchLogs ({updated.get('Status')})")
    except ClientError as exc:
        print(f"[TXSEARCH] destination update failed: {exc}")
        result["Destination"] = f"failed: {exc.response.get('Error', {}).get('Code', 'Unknown')}"

    # 3. Indexing percentage. Never lower a value someone else raised.
    try:
        rules = xray.get_indexing_rules().get("IndexingRules", [])
        existing = 0.0
        for rule in rules:
            if rule.get("Name") == "Default":
                existing = float(
                    (rule.get("Rule", {}).get("Probabilistic", {}) or {}).get("DesiredSamplingPercentage", 0)
                )
                break
        if existing >= INDEXING_PERCENTAGE:
            result["IndexingPercentage"] = f"left at {existing}"
            print(f"[TXSEARCH] indexing percentage left at {existing} (>= {INDEXING_PERCENTAGE})")
        else:
            xray.update_indexing_rule(
                Name="Default",
                Rule={"Probabilistic": {"DesiredSamplingPercentage": INDEXING_PERCENTAGE}},
            )
            result["IndexingPercentage"] = f"raised {existing} -> {INDEXING_PERCENTAGE}"
            print(f"[TXSEARCH] indexing percentage raised {existing} -> {INDEXING_PERCENTAGE}")
    except ClientError as exc:
        print(f"[TXSEARCH] indexing rule update failed: {exc}")
        result["IndexingPercentage"] = f"failed: {exc.response.get('Error', {}).get('Code', 'Unknown')}"

    return result


def on_event(event, _context):
    request_type = event.get("RequestType")
    print(f"[TXSEARCH] {request_type} in {REGION}")

    if request_type == "Delete":
        # Intentionally NOT reverted: this is shared account configuration and
        # other workloads may rely on it. See the module docstring.
        print("[TXSEARCH] Delete: leaving Transaction Search enabled (account-level shared setting)")
        return {"PhysicalResourceId": PHYSICAL_ID, "Data": {"Status": "left-enabled"}}

    try:
        data = _enable()
    except Exception as exc:  # noqa: BLE001 - never fail the deploy
        print(f"[TXSEARCH] unexpected error, continuing: {exc}")
        data = {"Status": f"skipped: {exc}"}

    return {"PhysicalResourceId": PHYSICAL_ID, "Data": data}
