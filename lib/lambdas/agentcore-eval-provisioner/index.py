# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""CDK custom-resource handler that provisions AgentCore Evaluations resources.

There is no CloudFormation resource for AgentCore Evaluations, so this Lambda
calls the preview `bedrock-agentcore-control` create/update/delete APIs on behalf
of the stack, keeping a custom LLM-as-a-judge evaluator plus an online evaluation
configuration inside the normal `cdk deploy` / `cdk destroy` lifecycle. The
online config binds the evaluator to the AI Assistant runtime's live spans
(``aws/spans`` filtered by service name), so the AgentCore console's
"Custom evaluators" and "Evaluation configurations" tabs show real, app-tied
entries and Observability starts scoring sessions.

It is intentionally BEST-EFFORT: Evaluations is a preview control-plane API. If
it is unavailable/denied in the account, this still returns success so the whole
deploy does not roll back — the console entries simply do not appear and the
reason is logged.

Delete ordering matters: the evaluator is LOCKED while an online config
references it, and an online config cannot be deleted while CREATING. So delete
the online config first (after it settles), then the evaluator, with retries.

Invoked through the CDK `Provider` framework — the handler returns a dict with
PhysicalResourceId and Data; the framework writes the CFN response.
"""

import os
import time

import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "us-east-1")
EVALUATOR_NAME = os.environ.get("EVALUATOR_NAME", "catalog_copy_quality")
ONLINE_EVAL_NAME = os.environ.get("ONLINE_EVAL_NAME", "ai_assistant_online_eval")
JUDGE_MODEL_ID = os.environ.get("JUDGE_MODEL_ID", "us.amazon.nova-pro-v1:0")
EXECUTION_ROLE_ARN = os.environ["EXECUTION_ROLE_ARN"]
SPANS_LOG_GROUP = os.environ.get("SPANS_LOG_GROUP", "aws/spans")
SERVICE_NAMES = [s for s in os.environ.get("SERVICE_NAMES", "").split(",") if s.strip()]
INSTRUCTIONS = os.environ.get("INSTRUCTIONS", "").strip()
SAMPLING_PERCENTAGE = float(os.environ.get("SAMPLING_PERCENTAGE", "100"))
SESSION_TIMEOUT_MINUTES = int(os.environ.get("SESSION_TIMEOUT_MINUTES", "5"))

# Returned when provisioning could not complete but the deploy must still
# succeed (preview API missing / access denied).
UNAVAILABLE = "eval-unavailable"

# Default judge rubric — mirrors the catalog brief. TRACE-level placeholders
# ({context}, {assistant_turn}) are REQUIRED and use single braces.
_DEFAULT_INSTRUCTIONS = (
    "You are a senior brand copy editor for a private bank. Assess the assistant's response on four "
    "dimensions: benefit-led language, clarity, on-brand voice with no hype or unverifiable "
    "superlatives, and length discipline. Consider the conversation context and score the latest "
    "assistant turn.\n"
    "Context: {context}\n"
    "Assistant turn: {assistant_turn}"
)


def _client():
    return boto3.client("bedrock-agentcore-control", region_name=REGION)


def _safe_name(raw: str) -> str:
    """Coerce to a conservative name constraint: ^[a-zA-Z][a-zA-Z0-9_]{0,47}$."""
    cleaned = "".join(c if (c.isalnum() or c == "_") else "_" for c in raw)
    if not cleaned or not cleaned[0].isalpha():
        cleaned = f"e_{cleaned}"
    return cleaned[:48]


def _evaluator_config() -> dict:
    return {
        "llmAsAJudge": {
            "instructions": INSTRUCTIONS or _DEFAULT_INSTRUCTIONS,
            "ratingScale": {
                "numerical": [
                    {
                        "definition": "excellent: benefit-led, clear, on-brand, right length",
                        "value": 1.0,
                        "label": "excellent",
                    },
                    {"definition": "adequate: minor issues", "value": 0.5, "label": "adequate"},
                    {
                        "definition": "poor: off-brand, unclear, or wrong length",
                        "value": 0.0,
                        "label": "poor",
                    },
                ]
            },
            "modelConfig": {"bedrockEvaluatorModelConfig": {"modelId": JUDGE_MODEL_ID}},
        }
    }


def _find_evaluator(client, name: str) -> str | None:
    try:
        token: dict = {}
        while True:
            resp = client.list_evaluators(maxResults=50, **token)
            for e in resp.get("items", resp.get("evaluatorSummaries", [])):
                if e.get("evaluatorName") == name:
                    return e.get("evaluatorId")
            nt = resp.get("nextToken")
            if not nt:
                return None
            token = {"nextToken": nt}
    except Exception as exc:  # noqa: BLE001 - best effort
        print(f"[EVAL] list_evaluators failed: {exc}")
        return None


def _find_online(client, name: str) -> str | None:
    try:
        token: dict = {}
        while True:
            resp = client.list_online_evaluation_configs(maxResults=50, **token)
            for o in resp.get("items", resp.get("onlineEvaluationConfigSummaries", [])):
                if o.get("onlineEvaluationConfigName") == name:
                    return o.get("onlineEvaluationConfigId")
            nt = resp.get("nextToken")
            if not nt:
                return None
            token = {"nextToken": nt}
    except Exception as exc:  # noqa: BLE001 - best effort
        print(f"[EVAL] list_online_evaluation_configs failed: {exc}")
        return None


def _create_evaluator(client, name: str) -> str | None:
    try:
        r = client.create_evaluator(
            evaluatorName=name,
            description="Custom copy-quality judge for the AI Assistant (managed by CDK).",
            level="TRACE",
            evaluatorConfig=_evaluator_config(),
        )
        eid = r.get("evaluatorId")
        print(f"[EVAL] created evaluator {eid}")
        return eid
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConflictException":
            existing = _find_evaluator(client, name)
            print(f"[EVAL] evaluator exists: {existing}")
            return existing
        print(f"[EVAL] create_evaluator failed: {exc}")
        return None


def _create_online(client, name: str, evaluator_id: str) -> str | None:
    data_source = {"cloudWatchLogs": {"logGroupNames": [SPANS_LOG_GROUP], "serviceNames": SERVICE_NAMES}}
    try:
        r = client.create_online_evaluation_config(
            onlineEvaluationConfigName=name,
            description="Scores live AI Assistant sessions with the custom copy-quality judge (managed by CDK).",
            rule={
                "samplingConfig": {"samplingPercentage": SAMPLING_PERCENTAGE},
                "sessionConfig": {"sessionTimeoutMinutes": SESSION_TIMEOUT_MINUTES},
            },
            dataSourceConfig=data_source,
            evaluators=[{"evaluatorId": evaluator_id}] if evaluator_id else [],
            evaluationExecutionRoleArn=EXECUTION_ROLE_ARN,
            enableOnCreate=True,
        )
        oid = r.get("onlineEvaluationConfigId") or r.get("id")
        print(f"[EVAL] created online-eval {oid}")
        return oid
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConflictException":
            existing = _find_online(client, name)
            print(f"[EVAL] online-eval exists: {existing}")
            return existing
        print(f"[EVAL] create_online_evaluation_config failed: {exc}")
        return None


def _data(evaluator_id: str, online_id: str, status: str) -> dict:
    """CFN response Data — ALWAYS carries both attribute keys so the stack's
    CfnOutputs never fail with a missing-attribute error (which rolls back)."""
    return {"EvaluatorId": evaluator_id, "OnlineEvalId": online_id, "Status": status}


def _pack(evaluator_id: str | None, online_id: str | None) -> str:
    return f"{evaluator_id or ''}|{online_id or ''}"


def _unpack(physical_id: str) -> tuple[str, str]:
    if "|" in (physical_id or ""):
        a, b = physical_id.split("|", 1)
        return a, b
    return "", ""


def _on_create() -> dict:
    client = _client()
    ev_name = _safe_name(EVALUATOR_NAME)
    oe_name = _safe_name(ONLINE_EVAL_NAME)
    try:
        evaluator_id = _create_evaluator(client, ev_name) or _find_evaluator(client, ev_name)
        online_id = _create_online(client, oe_name, evaluator_id) if evaluator_id else None
        if not evaluator_id and not online_id:
            print("[EVAL] nothing provisioned; continuing (deploy not blocked)")
            # Return the attribute keys (empty) even on skip so the stack's
            # CfnOutputs can read them — a missing attribute rolls back the stack.
            return {"PhysicalResourceId": UNAVAILABLE, "Data": _data("", "", "SKIPPED")}
        return {
            "PhysicalResourceId": _pack(evaluator_id, online_id),
            "Data": _data(evaluator_id or "", online_id or "", "CREATED"),
        }
    except Exception as exc:  # noqa: BLE001 - never fail the deploy
        print(f"[EVAL] unexpected create error, continuing: {exc}")
        return {"PhysicalResourceId": UNAVAILABLE, "Data": _data("", "", "SKIPPED")}


def _delete_online(client, online_id: str) -> None:
    """Delete the online config; it cannot be deleted while CREATING, so retry."""
    for _ in range(18):
        try:
            client.delete_online_evaluation_config(onlineEvaluationConfigId=online_id)
            print(f"[EVAL] deleted online-eval {online_id}")
            return
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code == "ResourceNotFoundException":
                return
            if code == "ConflictException":  # still CREATING/updating — wait
                time.sleep(10)
                continue
            print(f"[EVAL] delete online-eval failed (ignored): {exc}")
            return
        except Exception as exc:  # noqa: BLE001
            print(f"[EVAL] delete online-eval error (ignored): {exc}")
            return


def _delete_evaluator(client, evaluator_id: str) -> None:
    """Delete the evaluator; it is LOCKED while referenced, so retry as the
    online config's deletion releases the lock."""
    for _ in range(18):
        try:
            client.delete_evaluator(evaluatorId=evaluator_id)
            print(f"[EVAL] deleted evaluator {evaluator_id}")
            return
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code == "ResourceNotFoundException":
                return
            if code in ("ConflictException", "ValidationException"):  # locked — wait
                time.sleep(10)
                continue
            print(f"[EVAL] delete evaluator failed (ignored): {exc}")
            return
        except Exception as exc:  # noqa: BLE001
            print(f"[EVAL] delete evaluator error (ignored): {exc}")
            return


def _on_delete(physical_id: str) -> dict:
    if not physical_id or physical_id == UNAVAILABLE:
        return {"PhysicalResourceId": physical_id or UNAVAILABLE}
    evaluator_id, online_id = _unpack(physical_id)
    client = _client()
    if online_id:
        _delete_online(client, online_id)
    if evaluator_id:
        _delete_evaluator(client, evaluator_id)
    return {"PhysicalResourceId": physical_id}


def on_event(event, _context):
    request_type = event.get("RequestType")
    print(f"[EVAL] {request_type} in {REGION} (services={SERVICE_NAMES})")
    if request_type == "Create":
        return _on_create()
    if request_type == "Update":
        # Simplest robust path: retire the old resources, then recreate with the
        # current config. Best-effort deletes never block the deploy.
        old = event.get("PhysicalResourceId", "")
        if old and old != UNAVAILABLE:
            try:
                _on_delete(old)
            except Exception as exc:  # noqa: BLE001
                print(f"[EVAL] update cleanup failed (ignored): {exc}")
        return _on_create()
    if request_type == "Delete":
        return _on_delete(event.get("PhysicalResourceId", ""))
    return {"PhysicalResourceId": event.get("PhysicalResourceId", UNAVAILABLE)}
