# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""CDK custom-resource handler that provisions an AgentCore Harness.

There is no CloudFormation resource for AgentCore Harness (only Runtime), so this
Lambda calls the `bedrock-agentcore-control` create/update/delete APIs on behalf
of the stack, keeping the harness inside the normal `cdk deploy` / `cdk destroy`
lifecycle.

It is intentionally BEST-EFFORT: Harness is a preview control-plane API, and if
it is unavailable or access-denied in the account, this still returns success so
the whole stack deploy does not roll back. In that case the console entry simply
does not appear and the failure reason is logged. The harness is created with
only the required fields plus a system prompt (model defaults to Claude Sonnet
4.6); tools/memory are intentionally omitted to keep provisioning robust.

Invoked through the CDK `Provider` framework, so the handler just returns a dict
with PhysicalResourceId and Data — the framework handles the CFN response.
"""

import os

import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "us-east-1")
HARNESS_NAME = os.environ.get("HARNESS_NAME", "quick_assistant")
EXECUTION_ROLE_ARN = os.environ["EXECUTION_ROLE_ARN"]
SYSTEM_PROMPT = os.environ.get("SYSTEM_PROMPT", "").strip()

# Sentinel returned when provisioning could not complete but the deploy must
# still succeed (preview API missing / access denied).
UNAVAILABLE = "harness-unavailable"


def _client():
    return boto3.client("bedrock-agentcore-control", region_name=REGION)


def _safe_name(raw: str) -> str:
    """Coerce to the CreateHarness name constraint: ^[a-zA-Z][a-zA-Z0-9_]{0,39}$."""
    cleaned = "".join(c if (c.isalnum() or c == "_") else "_" for c in raw)
    if not cleaned or not cleaned[0].isalpha():
        cleaned = f"h_{cleaned}"
    return cleaned[:40]


def _create(client, name: str) -> dict:
    """Create the harness, falling back to the minimal payload on validation error."""
    full = {"harnessName": name, "executionRoleArn": EXECUTION_ROLE_ARN}
    if SYSTEM_PROMPT:
        full["systemPrompt"] = [{"text": SYSTEM_PROMPT}]
    try:
        return client.create_harness(**full)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code == "ValidationException" and "systemPrompt" in full:
            # The system-prompt content-block shape may differ across preview
            # revisions; retry with just the required fields so the entry still
            # gets created.
            print(f"[HARNESS] create with systemPrompt failed ({exc}); retrying minimal")
            return client.create_harness(harnessName=name, executionRoleArn=EXECUTION_ROLE_ARN)
        raise


def _find_existing(client, name: str) -> str | None:
    """Return the ARN of an existing harness with this name, if any."""
    try:
        paginator_input: dict = {}
        while True:
            resp = client.list_harnesses(**paginator_input)
            for h in resp.get("harnesses", resp.get("harnessSummaries", [])):
                if h.get("harnessName") == name:
                    return h.get("arn") or h.get("harnessArn")
            token = resp.get("nextToken")
            if not token:
                return None
            paginator_input = {"nextToken": token}
    except Exception as exc:  # noqa: BLE001 - best effort
        print(f"[HARNESS] list_harnesses failed: {exc}")
        return None


def _on_create(name: str) -> dict:
    client = _client()
    try:
        resp = _create(client, name)
        harness = resp.get("harness", resp)
        arn = harness.get("arn") or harness.get("harnessArn") or name
        print(f"[HARNESS] created: {arn}")
        return {"PhysicalResourceId": arn, "Data": {"HarnessArn": arn, "Status": "CREATED"}}
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code == "ConflictException":
            existing = _find_existing(client, name) or name
            print(f"[HARNESS] already exists: {existing}")
            return {
                "PhysicalResourceId": existing,
                "Data": {"HarnessArn": existing, "Status": "EXISTS"},
            }
        # Preview API missing / access denied / other: do NOT fail the stack.
        print(f"[HARNESS] create failed, continuing without harness: {exc}")
        return {"PhysicalResourceId": UNAVAILABLE, "Data": {"HarnessArn": "", "Status": "SKIPPED"}}
    except Exception as exc:  # noqa: BLE001 - best effort, never fail the deploy
        print(f"[HARNESS] unexpected create error, continuing: {exc}")
        return {"PhysicalResourceId": UNAVAILABLE, "Data": {"HarnessArn": "", "Status": "SKIPPED"}}


_UNHEALTHY = {"CREATE_FAILED", "DELETE_FAILED", "UPDATE_FAILED"}


def _get_harness(client, harness_id: str) -> dict | None:
    """Return the harness resource dict, or None if it no longer exists."""
    try:
        r = client.get_harness(harnessId=harness_id)
        return r.get("harness", r) or {}
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ResourceNotFoundException":
            return None
        raise
    except Exception:  # noqa: BLE001 - best effort
        return None


def _on_delete(physical_id: str, name: str) -> dict:
    if not physical_id or physical_id == UNAVAILABLE:
        return {"PhysicalResourceId": physical_id or UNAVAILABLE}
    client = _client()
    # PhysicalResourceId is the ARN; the delete API takes the harness id.
    harness_id = physical_id.split("/")[-1] if "/" in physical_id else physical_id
    try:
        client.delete_harness(harnessId=harness_id)
        print(f"[HARNESS] deleted: {harness_id}")
    except Exception as exc:  # noqa: BLE001 - never block a destroy
        print(f"[HARNESS] delete failed (ignored): {exc}")
    return {"PhysicalResourceId": physical_id}


def on_event(event, _context):
    request_type = event.get("RequestType")
    name = _safe_name(HARNESS_NAME)
    print(f"[HARNESS] {request_type} for harness '{name}' in {REGION}")

    if request_type == "Create":
        return _on_create(name)
    if request_type == "Update":
        # Self-heal: keep the same harness when it is healthy and already carries
        # the desired name, but re-create if the previous attempt was skipped, the
        # harness was deleted, it is in a failed state (e.g. CREATE_FAILED from a
        # since-fixed permission gap), OR the requested name changed (a rename).
        physical_id = event.get("PhysicalResourceId", "")
        if physical_id and physical_id != UNAVAILABLE:
            client = _client()
            harness_id = physical_id.split("/")[-1] if "/" in physical_id else physical_id
            existing = _get_harness(client, harness_id)
            if existing is not None:
                existing_name = existing.get("harnessName")
                status = existing.get("status")
                if existing_name == name and status not in _UNHEALTHY:
                    return {
                        "PhysicalResourceId": physical_id,
                        "Data": {"HarnessArn": physical_id, "Status": status},
                    }
                # A rename: retire the old harness so the console shows only the
                # new one. Best-effort — a failed delete must not block the deploy.
                if existing_name and existing_name != name:
                    print(f"[HARNESS] renaming '{existing_name}' -> '{name}'; deleting old")
                    try:
                        client.delete_harness(harnessId=harness_id)
                    except Exception as exc:  # noqa: BLE001 - best effort
                        print(f"[HARNESS] old harness delete failed (ignored): {exc}")
                else:
                    print(f"[HARNESS] existing harness status={status}; re-creating")
        return _on_create(name)
    if request_type == "Delete":
        return _on_delete(event.get("PhysicalResourceId", ""), name)

    return {"PhysicalResourceId": event.get("PhysicalResourceId", UNAVAILABLE)}
