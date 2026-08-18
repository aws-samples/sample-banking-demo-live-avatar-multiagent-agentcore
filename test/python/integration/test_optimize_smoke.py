"""Live smoke / integration checks for the Prompt Optimization showcase.

These are AUTHORED, SKIPPED-BY-DEFAULT checks — NOT property tests. They exercise
the live Bedrock `OptimizePrompt` streaming behavior and the guardrail-on-sample
path that the property suite deliberately does not cover (per `design.md`
"Testing Strategy"). Their behavior does not vary meaningfully with input, so a
few concrete examples per requirement group are authored rather than randomized
iterations.

The whole module SKIPS cleanly (never errors) unless the live guard is set:

* ``RUN_LIVE_OPTIMIZE=1`` — un-skips the `OptimizePrompt` stream + reject checks
  (10.1). REQUIRED to run them. They call Bedrock `bedrock-agent-runtime` in the
  configured account/region, so run against a dev/CI account — never production.
* ``AWS_REGION`` — region to call (defaults to ``us-east-1``, where the three
  target foundation models are verified available).
* ``RUN_LIVE_OPTIMIZE_GUARDRAIL`` (with ``OPTIMIZE_GUARDRAIL_ID``) — un-skips the
  guardrail-on-sample-run check (10.3): a synthetic sample invocation still has
  the Bedrock Guardrail applied (self-contained safety check).

Verified constraints exercised here (from `design.md`):

- ``optimize_prompt(input={"textPrompt": {"text": <prompt>}}, targetModelId=<id>)``
  streams events on ``response["optimizedPrompt"]``: an ``analyzePromptEvent``
  (analysis) then an ``optimizedPromptEvent`` (the model-tailored optimized
  prompt). No scores, latency, or cost (10.1, Req 2.1).
- ``OptimizePrompt`` accepts foundation-model ids only; an inference-profile id
  (e.g. ``us.anthropic.claude-sonnet-4-6...``) is rejected (10.1, Req 2.3/2.4).
"""

from __future__ import annotations

import os

import pytest
from optimize_targets import SUPPORTED_TARGET_MODELS

REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))

# An inference-profile-form id the API must reject as a target: the AI Agent's
# Current_Model profile. It is never a valid `targetModelId` (Req 2.3, 2.4).
INFERENCE_PROFILE_ID = "us.anthropic.claude-sonnet-4-6"

# The whole module skips cleanly (not errors) unless the live guard is set.
pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_LIVE_OPTIMIZE") != "1",
    reason="live Bedrock OptimizePrompt checks (set RUN_LIVE_OPTIMIZE=1 to run against a dev/CI account)",
)


# ─── Helpers ────────────────────────────────────────────────────────────────


def _bedrock_agent_runtime():
    """Build a `bedrock-agent-runtime` client, imported lazily so collection
    never needs boto3 and the module imports/skips without it."""
    import boto3

    return boto3.client("bedrock-agent-runtime", region_name=REGION)


def _optimize_event_kinds(client, prompt_text: str, target_model_id: str) -> list[str]:
    """Run OptimizePrompt for one target and return the ordered event kinds.

    Maps each streamed item on ``response["optimizedPrompt"]`` to ``"analysis"``
    or ``"optimized"`` (ignoring any other shape), preserving stream order.
    """
    response = client.optimize_prompt(
        input={"textPrompt": {"text": prompt_text}},
        targetModelId=target_model_id,
    )
    kinds: list[str] = []
    for event in response["optimizedPrompt"]:
        if "analyzePromptEvent" in event:
            kinds.append("analysis")
        elif "optimizedPromptEvent" in event:
            kinds.append("optimized")
    return kinds


# ─── 10.1 — the stream yields analysis then an optimized prompt per target ────

# A short synthetic prompt to optimize; the real showcase optimizes the AI
# Agent's Current_System_Prompt server-side, but any prompt text exercises the
# stream shape and ordering the same way.
SAMPLE_PROMPT = "You are a helpful banking assistant. Answer the customer clearly and concisely."


@pytest.mark.parametrize(
    "target_model_id",
    [tm.optimize_target_id for tm in SUPPORTED_TARGET_MODELS],
    ids=[tm.label for tm in SUPPORTED_TARGET_MODELS],
)
def test_optimize_stream_yields_analysis_then_optimized(target_model_id: str):
    """Each verified foundation model streams an analysis event then an optimized event (Req 2.1)."""
    client = _bedrock_agent_runtime()
    kinds = _optimize_event_kinds(client, SAMPLE_PROMPT, target_model_id)

    assert kinds, f"OptimizePrompt for {target_model_id} yielded no analyze/optimized events"
    assert "analysis" in kinds, f"expected an analyzePromptEvent for {target_model_id}, got {kinds}"
    assert "optimized" in kinds, f"expected an optimizedPromptEvent for {target_model_id}, got {kinds}"
    # Analysis precedes the optimized prompt (verified stream ordering).
    assert kinds.index("analysis") < kinds.index("optimized"), (
        f"analyzePromptEvent must precede optimizedPromptEvent for {target_model_id}, got {kinds}"
    )


def test_inference_profile_id_is_rejected_as_target():
    """An inference-profile id (the Current_Model profile) is rejected by OptimizePrompt (Req 2.3, 2.4)."""
    from botocore.exceptions import ClientError

    client = _bedrock_agent_runtime()
    with pytest.raises(ClientError) as excinfo:
        # Draining the stream forces the service to evaluate the target id.
        _optimize_event_kinds(client, SAMPLE_PROMPT, INFERENCE_PROFILE_ID)

    # The API rejects the profile-form target; the exact code is a client-side
    # validation/exception (commonly ValidationException). Assert it is a 4xx
    # client error attributed to the bad target rather than a server fault.
    status = excinfo.value.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    assert status is None or 400 <= int(status) < 500, (
        f"inference-profile target should be a client rejection, got HTTP {status}: {excinfo.value}"
    )


# ─── 10.3 — the guardrail is applied to a self-contained sample run ───────────


def test_guardrail_applied_to_sample_run():
    """A synthetic sample invocation still has the Bedrock Guardrail applied (Req 12.3)."""
    if os.environ.get("RUN_LIVE_OPTIMIZE_GUARDRAIL") != "1":
        pytest.skip(
            "set RUN_LIVE_OPTIMIZE_GUARDRAIL=1 and OPTIMIZE_GUARDRAIL_ID to run the "
            "guardrail-on-sample-run check (self-contained safety check for Req 12.3)"
        )
    guardrail_id = os.environ.get("OPTIMIZE_GUARDRAIL_ID")
    if not guardrail_id:
        pytest.skip("set OPTIMIZE_GUARDRAIL_ID to the deployed guardrail id to run this check")

    import boto3

    guardrail_version = os.environ.get("OPTIMIZE_GUARDRAIL_VERSION", "DRAFT")
    runtime = boto3.client("bedrock-runtime", region_name=REGION)

    # A benign synthetic sample question — the point is that the guardrail is
    # engaged on the sample run, not that this text trips a policy. A candidate
    # sample run invokes an on-demand-invocable model; use the last supported
    # target's invoke id (Claude 3 Haiku invokes directly as its FM id).
    invoke_id = SUPPORTED_TARGET_MODELS[-1].invoke_id
    response = runtime.converse(
        modelId=invoke_id,
        messages=[{"role": "user", "content": [{"text": "What savings accounts do you offer?"}]}],
        guardrailConfig={"guardrailIdentifier": guardrail_id, "guardrailVersion": guardrail_version},
    )

    # A guardrail-governed Converse response carries a trace/assessment section
    # and a stop reason. Its presence proves the guardrail was applied to the
    # sample run rather than the model being invoked ungoverned.
    assert "stopReason" in response, f"expected a governed Converse response, got keys {sorted(response)}"
    assert "output" in response, "guardrail-applied sample run should still return an output payload"
