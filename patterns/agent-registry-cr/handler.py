# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""CDK custom-resource handler that provisions an AWS Agent Registry (PREVIEW).

There is no CloudFormation resource for the AWS Agent Registry, so this Lambda
calls the `agent-registry-control` create/get/list/delete APIs on behalf of the
stack, keeping the registry and its APPROVED agent records inside the normal
`cdk deploy` / `cdk destroy` lifecycle. This is what makes the (otherwise empty)
AWS Agent Registry console list the demo's A2A agents after a deploy.

Invoked through the CDK `Provider` framework, so the handler returns a dict with
``PhysicalResourceId`` and ``Data`` — the framework builds the CloudFormation
response. It is defensive by design: bounded polling with sleeps, per-record
error isolation (one bad record never aborts the rest), tolerant of
already-exists / already-approved conditions, and a Delete path that ALWAYS
reports success so a stack delete is never blocked.

Empirically verified against the preview API (boto3 >= 1.43.74):
  * create_registry(...) is ASYNC — poll get_registry(...)["status"] until
    "READY"; records cannot be created before then (ConflictException
    "Registry is not in READY state").
  * a2a records require descriptors.a2aAgentCard.dataSchemaVersion == "0.3.0".
  * a record starts "CREATING" then "DRAFT"; approval is
    submit_registry_record_for_approval -> PENDING_APPROVAL ->
    update_registry_record_status(status="APPROVED", statusReason=<non-empty>).
    statusReason is REQUIRED.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any
from urllib.parse import quote

import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "us-east-1")

# A2A protocol / card schema version. VERIFIED: the a2a descriptor is rejected
# unless dataSchemaVersion is exactly "0.3.0".
A2A_SCHEMA_VERSION = "0.3.0"

# Non-empty approval reason — update_registry_record_status fails without one.
APPROVAL_REASON = "Auto-approved by deploy"

# Bounded polling budgets (seconds). The registry create is the slow one — it
# can take a couple of minutes to reach READY.
REGISTRY_READY_TIMEOUT = 300
RECORD_DRAFT_TIMEOUT = 120
POLL_INTERVAL = 10

# Sentinel physical id used when nothing could be provisioned but the deploy
# must still succeed (preview API unavailable / access denied).
UNAVAILABLE = "agent-registry-unavailable"

_TERMINAL_UNHEALTHY = {"CREATE_FAILED", "FAILED"}


def _client():
    return boto3.client("agent-registry-control", region_name=REGION)


def _error_code(exc: ClientError) -> str:
    return exc.response.get("Error", {}).get("Code", "")


def _sanitize(raw: str, *, max_len: int = 64) -> str:
    """Coerce to the ``[a-zA-Z0-9]+`` name constraint (registries and records).

    Hyphens/underscores/spaces are stripped so a human-friendly source name like
    ``fraud-research-agent`` becomes a valid ``fraudresearchagent``.
    """
    cleaned = "".join(c for c in raw if c.isalnum())
    if not cleaned:
        cleaned = "agent"
    if not cleaned[0].isalpha():
        cleaned = f"a{cleaned}"
    return cleaned[:max_len]


# ─── Registry ─────────────────────────────────────────────────────────────────


def _registry_id(item: dict[str, Any]) -> str | None:
    return item.get("registryArn") or item.get("arn") or item.get("registryId")


def _find_registry(client, name: str) -> str | None:
    """Return the id/ARN of an existing registry with this name, if any."""
    try:
        params: dict = {}
        while True:
            resp = client.list_registries(**params)
            items = resp.get("registries", resp.get("registrySummaries", []))
            for item in items:
                if item.get("name") == name:
                    return _registry_id(item)
            token = resp.get("nextToken")
            if not token:
                return None
            params = {"nextToken": token}
    except Exception as exc:  # noqa: BLE001 - best effort discovery
        print(f"[REGISTRY] list_registries failed: {exc}")
        return None


def _registry_status(client, registry_id: str) -> str | None:
    """Return the registry status, or None if it no longer exists."""
    try:
        resp = client.get_registry(registryId=registry_id)
        return (resp.get("registry", resp) or {}).get("status")
    except ClientError as exc:
        if _error_code(exc) == "ResourceNotFoundException":
            return None
        raise


def _wait_registry_ready(client, registry_id: str) -> bool:
    """Poll until the registry is READY. Returns True if it reached READY."""
    deadline = time.monotonic() + REGISTRY_READY_TIMEOUT
    while time.monotonic() < deadline:
        status = _registry_status(client, registry_id)
        print(f"[REGISTRY] {registry_id} status={status}")
        if status == "READY":
            return True
        if status in _TERMINAL_UNHEALTHY:
            print(f"[REGISTRY] terminal status {status}; giving up on READY")
            return False
        time.sleep(POLL_INTERVAL)
    print(f"[REGISTRY] timed out waiting for READY after {REGISTRY_READY_TIMEOUT}s")
    return False


def _ensure_registry(client, name: str, description: str) -> str | None:
    """Idempotently ensure a READY registry named ``name`` exists.

    Returns the registry id/ARN, or None if it could not be made READY.
    """
    existing = _find_registry(client, name)
    if existing:
        # A registry left in a terminal-unhealthy state (e.g. CREATE_FAILED from
        # a prior run that lacked the workload-identity permission) can never
        # become READY and would trap every retry. Delete it and recreate.
        existing_status = _registry_status(client, existing)
        if existing_status in _TERMINAL_UNHEALTHY:
            print(f"[REGISTRY] existing {existing} is {existing_status}; deleting to recreate")
            try:
                client.delete_registry(registryId=existing)
            except Exception as exc:  # noqa: BLE001 - best effort; recreate regardless
                print(f"[REGISTRY] delete of unhealthy registry failed (continuing): {exc}")
            existing = None

    if existing:
        print(f"[REGISTRY] found existing: {existing}")
        registry_id = existing
    else:
        try:
            resp = client.create_registry(
                name=name,
                description=description,
                discoveryConfiguration={"authorizerType": "AWS_IAM"},
            )
        except ClientError as exc:
            if _error_code(exc) == "ConflictException":
                # Raced with a concurrent create (or exists under a different
                # list shape) — re-resolve by name.
                registry_id = _find_registry(client, name)
                if not registry_id:
                    raise
                print(f"[REGISTRY] conflict on create; using {registry_id}")
                return registry_id if _wait_registry_ready(client, registry_id) else None
            raise
        registry_id = _registry_id(resp) or resp.get("registryArn")
        print(f"[REGISTRY] created: {registry_id}")

    if not registry_id:
        return None
    return registry_id if _wait_registry_ready(client, registry_id) else None


# ─── Records ────────────────────────────────────────────────────────────────


def _record_id(item: dict[str, Any]) -> str | None:
    return item.get("recordArn") or item.get("arn") or item.get("recordId")


def _find_record(client, registry_id: str, name: str) -> str | None:
    """Return the id/ARN of an existing record with this name, if any."""
    try:
        params: dict = {"registryId": registry_id}
        while True:
            resp = client.list_registry_records(**params)
            items = resp.get("records", resp.get("recordSummaries", []))
            for item in items:
                if item.get("name") == name:
                    return _record_id(item)
            token = resp.get("nextToken")
            if not token:
                return None
            params = {"registryId": registry_id, "nextToken": token}
    except Exception as exc:  # noqa: BLE001 - best effort discovery
        print(f"[RECORD] list_registry_records failed: {exc}")
        return None


def _record_status(client, registry_id: str, record_id: str) -> str | None:
    try:
        resp = client.get_registry_record(registryId=registry_id, recordId=record_id)
        return (resp.get("record", resp) or {}).get("status")
    except ClientError as exc:
        if _error_code(exc) == "ResourceNotFoundException":
            return None
        raise


def _wait_record_status(client, registry_id: str, record_id: str, targets: set[str]) -> str | None:
    """Poll until the record reaches one of ``targets`` (or a terminal state)."""
    deadline = time.monotonic() + RECORD_DRAFT_TIMEOUT
    status = None
    while time.monotonic() < deadline:
        status = _record_status(client, registry_id, record_id)
        print(f"[RECORD] {record_id} status={status}")
        if status in targets:
            return status
        if status in _TERMINAL_UNHEALTHY or status is None:
            return status
        time.sleep(POLL_INTERVAL)
    return status


def _runtime_invocation_url(runtime_arn: str) -> str:
    """Build the AgentCore runtime invocation URL the a2a card advertises.

    Mirrors ``patterns/utils/a2a_client.runtime_invocation_url`` so the published
    card URL matches the discovery contract the caller uses.
    """
    encoded = quote(runtime_arn, safe="")
    return f"https://bedrock-agentcore.{REGION}.amazonaws.com/runtimes/{encoded}/invocations/"


def _build_a2a_card(agent: dict[str, Any]) -> dict[str, Any]:
    """Build the wire-shaped A2A agent card for a registry record.

    Follows ``patterns/fraud-research-agent/agent_card.build_agent_card`` plus an
    explicit ``protocolVersion`` of 0.3.0.
    """
    url = agent.get("url")
    if not url:
        runtime_arn = (agent.get("runtimeArn") or "").strip()
        url = _runtime_invocation_url(runtime_arn) if runtime_arn else ""
    skills = [
        {
            "id": skill["id"],
            "name": skill["name"],
            "description": skill["description"],
            "tags": list(skill.get("tags", [])),
        }
        for skill in agent.get("skills", [])
    ]
    return {
        "protocolVersion": A2A_SCHEMA_VERSION,
        "name": agent["name"],
        "description": agent["description"],
        "version": agent.get("version", "1.0.0"),
        "url": url,
        "preferredTransport": agent.get("preferredTransport", "JSONRPC"),
        "capabilities": {"streaming": True},
        "defaultInputModes": ["text"],
        "defaultOutputModes": ["text"],
        "skills": skills,
    }


def _approve_record(client, registry_id: str, record_id: str, current_status: str | None) -> None:
    """Drive a record from DRAFT/PENDING_APPROVAL to APPROVED, tolerating re-runs."""
    if current_status == "APPROVED":
        print(f"[RECORD] {record_id} already APPROVED; skipping")
        return

    if current_status != "PENDING_APPROVAL":
        # DRAFT (or freshly created) — submit for approval first.
        try:
            client.submit_registry_record_for_approval(registryId=registry_id, recordId=record_id)
            print(f"[RECORD] {record_id} submitted for approval")
        except ClientError as exc:
            code = _error_code(exc)
            # Already submitted/approved concurrently — carry on to the approve.
            if code not in ("ConflictException", "ValidationException"):
                raise
            print(f"[RECORD] submit tolerated ({code}): {exc}")
        _wait_record_status(client, registry_id, record_id, {"PENDING_APPROVAL", "APPROVED"})

    latest = _record_status(client, registry_id, record_id)
    if latest == "APPROVED":
        print(f"[RECORD] {record_id} already APPROVED after submit; skipping status update")
        return
    client.update_registry_record_status(
        registryId=registry_id,
        recordId=record_id,
        status="APPROVED",
        statusReason=APPROVAL_REASON,
    )
    print(f"[RECORD] {record_id} APPROVED")


def _build_descriptors(agent: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Build (recordType, descriptors) for one agent definition.

    Two record types are published:

    - AGENT (default): a genuine A2A callee with an agent card — the descriptor
      is the wire-shaped card, validated against the A2A schema (0.3.0).
    - CUSTOM (recordType="CUSTOM"): a resource that is invocable but not over
      A2A — e.g. the Deep Research pipeline runtime, which speaks the AgentCore
      HTTP protocol. Its descriptor is free-form JSON (VERIFIED live: no
      dataSchemaVersion needed) carrying capability + invocation metadata, so
      the catalog stays honest — no fabricated A2A endpoint is advertised.
    """
    if (agent.get("recordType") or "AGENT").upper() == "CUSTOM":
        runtime_arn = (agent.get("runtimeArn") or "").strip()
        payload = {
            "resourceType": "agentcore_runtime",
            "name": agent["name"],
            "description": agent["description"],
            "version": agent.get("version", "1.0.0"),
            "owner": agent.get("owner", ""),
            "invocation": {
                "protocol": "AgentCore HTTP (SSE)",
                "runtimeArn": runtime_arn,
                "url": _runtime_invocation_url(runtime_arn) if runtime_arn else "",
                "payloadContract": agent.get("payloadContract", {}),
            },
            "skills": agent.get("skills", []),
            "phases": agent.get("phases", []),
        }
        return "CUSTOM", {"custom": {"data": json.dumps(payload)}}

    card = _build_a2a_card(agent)
    return "AGENT", {
        "a2aAgentCard": {
            "data": json.dumps(card),
            "dataSchemaVersion": A2A_SCHEMA_VERSION,
        }
    }


def _upsert_record(client, registry_id: str, agent: dict[str, Any]) -> None:
    """Idempotently create + approve one AGENT/CUSTOM record. Errors are isolated."""
    record_name = _sanitize(agent.get("recordName") or agent["name"])
    display_name = agent.get("displayName") or agent["name"]
    record_type, descriptors = _build_descriptors(agent)

    existing = _find_record(client, registry_id, record_name)
    if existing:
        record_id = existing
        print(f"[RECORD] found existing '{record_name}': {record_id}")
    else:
        resp = client.create_registry_record(
            registryId=registry_id,
            name=record_name,
            recordType=record_type,
            displayName=display_name,
            descriptors=descriptors,
        )
        record_id = _record_id(resp) or resp.get("recordArn")
        print(f"[RECORD] created '{record_name}' ({record_type}): {record_id} status={resp.get('status')}")

    if not record_id:
        print(f"[RECORD] no record id resolved for '{record_name}'; skipping approval")
        return

    # Wait for DRAFT (or a later state on a re-run) before approving.
    status = _wait_record_status(client, registry_id, record_id, {"DRAFT", "PENDING_APPROVAL", "APPROVED"})
    if status in _TERMINAL_UNHEALTHY or status is None:
        print(f"[RECORD] '{record_name}' not approvable (status={status}); skipping")
        return
    _approve_record(client, registry_id, record_id, status)


# ─── Lifecycle ────────────────────────────────────────────────────────────────


def _parse_agents(props: dict[str, Any]) -> list[dict[str, Any]]:
    raw = props.get("Agents", "[]")
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw or "[]")
        except json.JSONDecodeError as exc:
            print(f"[REGISTRY] bad Agents JSON, treating as empty: {exc}")
            return []
    else:
        parsed = raw
    return parsed if isinstance(parsed, list) else []


def _on_create_update(props: dict[str, Any]) -> dict[str, Any]:
    registry_name = _sanitize(props.get("RegistryName") or "agentregistry")
    description = props.get("RegistryDescription") or f"Agent registry for {registry_name}"
    agents = _parse_agents(props)

    client = _client()
    try:
        registry_id = _ensure_registry(client, registry_name, description)
    except ClientError as exc:
        # Preview API missing / access denied / other: do NOT roll back the stack.
        print(f"[REGISTRY] ensure failed, continuing without registry: {exc}")
        return {
            "PhysicalResourceId": UNAVAILABLE,
            "Data": {"RegistryArn": UNAVAILABLE, "RegistryId": UNAVAILABLE, "Status": "SKIPPED"},
        }
    except Exception as exc:  # noqa: BLE001 - never fail the deploy on preview quirks
        print(f"[REGISTRY] unexpected ensure error, continuing: {exc}")
        return {
            "PhysicalResourceId": UNAVAILABLE,
            "Data": {"RegistryArn": UNAVAILABLE, "RegistryId": UNAVAILABLE, "Status": "SKIPPED"},
        }

    if not registry_id:
        print("[REGISTRY] registry never reached READY; skipping records")
        # Non-empty sentinel: an SSM parameter value cannot be an empty string.
        return {
            "PhysicalResourceId": UNAVAILABLE,
            "Data": {"RegistryArn": UNAVAILABLE, "RegistryId": UNAVAILABLE, "Status": "NOT_READY"},
        }

    for agent in agents:
        try:
            _upsert_record(client, registry_id, agent)
        except Exception as exc:  # noqa: BLE001 - isolate per-record failures
            name = agent.get("recordName") or agent.get("name") or "?"
            print(f"[RECORD] '{name}' failed (continuing): {exc}")

    return {
        "PhysicalResourceId": registry_id,
        "Data": {"RegistryArn": registry_id, "RegistryId": registry_id, "Status": "READY"},
    }


def _on_delete(physical_id: str) -> dict[str, Any]:
    """Best-effort: delete all records then the registry. Always succeeds."""
    if not physical_id or physical_id == UNAVAILABLE:
        return {"PhysicalResourceId": physical_id or UNAVAILABLE}

    registry_id = physical_id
    client = _client()

    # Delete every record first (the registry delete may be blocked otherwise).
    try:
        params: dict = {"registryId": registry_id}
        while True:
            resp = client.list_registry_records(**params)
            items = resp.get("records", resp.get("recordSummaries", []))
            for item in items:
                record_id = _record_id(item)
                if not record_id:
                    continue
                try:
                    client.delete_registry_record(registryId=registry_id, recordId=record_id)
                    print(f"[RECORD] deleted {record_id}")
                except Exception as exc:  # noqa: BLE001 - never block a destroy
                    print(f"[RECORD] delete failed (ignored): {exc}")
            token = resp.get("nextToken")
            if not token:
                break
            params = {"registryId": registry_id, "nextToken": token}
    except Exception as exc:  # noqa: BLE001 - never block a destroy
        print(f"[REGISTRY] listing records for delete failed (ignored): {exc}")

    try:
        client.delete_registry(registryId=registry_id)
        print(f"[REGISTRY] deleted {registry_id}")
    except ClientError as exc:
        if _error_code(exc) != "ResourceNotFoundException":
            print(f"[REGISTRY] delete failed (ignored): {exc}")
    except Exception as exc:  # noqa: BLE001 - never block a destroy
        print(f"[REGISTRY] delete failed (ignored): {exc}")

    return {"PhysicalResourceId": physical_id}


def on_event(event, _context):
    request_type = event.get("RequestType")
    props = event.get("ResourceProperties", {}) or {}
    print(f"[REGISTRY] {request_type} in {REGION} for '{props.get('RegistryName')}'")

    if request_type in ("Create", "Update"):
        return _on_create_update(props)
    if request_type == "Delete":
        return _on_delete(event.get("PhysicalResourceId", ""))

    return {"PhysicalResourceId": event.get("PhysicalResourceId", UNAVAILABLE)}
