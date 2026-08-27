# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""CDK custom-resource handler that provisions the AWS-managed Web Search Tool
built-in connector as an AgentCore Gateway target.

The `connector` MCP target type is newer than the
`AWS::BedrockAgentCore::GatewayTarget` CloudFormation resource spec (the L1
construct drops the key), so this Lambda calls the `bedrock-agentcore-control`
`create_gateway_target` API directly. The connector is pinned to a version
(1.2.0+) that adds a target-level domain include/exclude list plus per-request
domain and published-date filters the agent can apply.

Governance configured here is the target-level domain EXCLUDE (deny) list,
applied to every query and hidden from the calling agent. A target-level
INCLUDE list is intentionally NOT set by the caller: it would restrict every
query to those domains and break open-web research; the regulator allow-list
and published-date bound are applied per-query by the agent instead.

Create is authoritative — it raises on failure — because when the managed
connector is enabled the custom web_search Lambda is not created, so a silent
failure would leave agents with no web search. Create/Update are idempotent
(an existing target of the same name is updated in place). Delete is
best-effort so a stack destroy is never blocked.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "us-east-1")
_READY_TIMEOUT_SEC = 300
_POLL_INTERVAL_SEC = 5


def _control():
    return boto3.client("bedrock-agentcore-control", region_name=REGION)


def _error_code(exc: ClientError) -> str:
    return exc.response.get("Error", {}).get("Code", "")


def _target_configuration(props: dict[str, Any]) -> dict[str, Any]:
    """Build the connector targetConfiguration from the resource properties."""
    parameter_values: dict[str, Any] = {}
    exclude = json.loads(props.get("ExcludeDomains", "[]") or "[]")
    if exclude:
        parameter_values["domainFilter"] = {"exclude": exclude}

    return {
        "mcp": {
            "connector": {
                "source": {
                    "connectorId": props.get("ConnectorId", "web-search"),
                    "version": props["ConnectorVersion"],
                },
                "configurations": [
                    {"name": "WebSearch", "parameterValues": parameter_values},
                ],
            }
        }
    }


def _find_target_id(client, gateway_id: str, name: str) -> str | None:
    """Return the id of an existing target with `name`, if any."""
    params: dict = {"gatewayIdentifier": gateway_id}
    while True:
        resp = client.list_gateway_targets(**params)
        for item in resp.get("items", []):
            if item.get("name") == name:
                return item.get("targetId")
        token = resp.get("nextToken")
        if not token:
            return None
        params = {"gatewayIdentifier": gateway_id, "nextToken": token}


def _wait_ready(client, gateway_id: str, target_id: str) -> None:
    """Poll the target until it leaves CREATING/UPDATING; raise on failure."""
    deadline = time.time() + _READY_TIMEOUT_SEC
    while time.time() < deadline:
        resp = client.get_gateway_target(gatewayIdentifier=gateway_id, targetId=target_id)
        status = resp.get("status")
        if status in ("READY", "ACTIVE"):
            return
        if status in ("CREATE_FAILED", "UPDATE_FAILED", "FAILED"):
            reasons = resp.get("statusReasons") or resp.get("statusReason")
            raise RuntimeError(f"Web search target {target_id} entered {status}: {reasons}")
        # Bounded polling while the gateway target synchronizes its tool catalog.
        # nosemgrep: arbitrary-sleep
        time.sleep(_POLL_INTERVAL_SEC)
    # Timeout is not necessarily fatal — the target often finishes shortly
    # after — but surface it so the deploy does not report a false success.
    raise TimeoutError(f"Web search target {target_id} did not reach READY within {_READY_TIMEOUT_SEC}s")


def _on_create_update(props: dict[str, Any]) -> dict[str, Any]:
    gateway_id = props["GatewayId"]
    name = props["TargetName"]
    client = _control()
    config = _target_configuration(props)
    cred = [{"credentialProviderType": "GATEWAY_IAM_ROLE"}]

    existing = _find_target_id(client, gateway_id, name)
    if existing:
        client.update_gateway_target(
            gatewayIdentifier=gateway_id,
            targetId=existing,
            name=name,
            targetConfiguration=config,
            credentialProviderConfigurations=cred,
        )
        target_id = existing
        print(f"[WEBSEARCH] updated target '{name}' ({target_id})")
    else:
        resp = client.create_gateway_target(
            gatewayIdentifier=gateway_id,
            name=name,
            targetConfiguration=config,
            credentialProviderConfigurations=cred,
        )
        target_id = resp["targetId"]
        print(f"[WEBSEARCH] created target '{name}' ({target_id})")

    _wait_ready(client, gateway_id, target_id)
    return {"PhysicalResourceId": target_id, "Data": {"TargetId": target_id, "TargetName": name}}


def _on_delete(props: dict[str, Any], physical_id: str) -> dict[str, Any]:
    gateway_id = props.get("GatewayId")
    if gateway_id and physical_id and not physical_id.startswith("web-search-target"):
        try:
            _control().delete_gateway_target(gatewayIdentifier=gateway_id, targetId=physical_id)
            print(f"[WEBSEARCH] deleted target '{physical_id}'")
        except ClientError as exc:
            if _error_code(exc) != "ResourceNotFoundException":
                print(f"[WEBSEARCH] delete failed (ignored): {exc}")
        except Exception as exc:  # noqa: BLE001 - never block a destroy
            print(f"[WEBSEARCH] delete failed (ignored): {exc}")
    return {"PhysicalResourceId": physical_id}


def on_event(event, _context):
    request_type = event.get("RequestType")
    props = event.get("ResourceProperties", {}) or {}
    print(f"[WEBSEARCH] {request_type} for '{props.get('TargetName')}' on gateway '{props.get('GatewayId')}'")

    if request_type in ("Create", "Update"):
        return _on_create_update(props)
    if request_type == "Delete":
        return _on_delete(props, event.get("PhysicalResourceId", ""))
    return {"PhysicalResourceId": event.get("PhysicalResourceId", "web-search-target")}
