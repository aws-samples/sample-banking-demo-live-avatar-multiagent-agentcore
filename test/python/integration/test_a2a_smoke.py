"""Post-deploy integration / smoke checks for the A2A agent-collaboration feature.

These are AUTHORED, SKIPPED-BY-DEFAULT checks — NOT property tests. They exercise
the live-platform behaviors that the property suite deliberately does not cover
(per `design.md` "Testing Strategy" → "What can only be verified on deploy"):
the AgentCore JWT authorizer, Cedar enforcement, Bedrock Guardrail application,
one-trace/two-owner trace capture, agent-card serving over the wire, and
least-privilege IAM. Their behavior does not vary meaningfully with input, so
1–3 concrete examples per requirement group are authored rather than randomized
iterations.

The whole module SKIPS cleanly (never errors) unless a deployed A2A runtime is
present. Set ``FRAUD_AGENT_RUNTIME_ARN`` (the value published by the stack at
``/<stack>/runtime_arn_fraud_research``) to enable them, and run against a
dev/CI account — never production.

Environment variables (only the first is required to un-skip the module):

* ``FRAUD_AGENT_RUNTIME_ARN`` — the deployed fraud-research runtime ARN. REQUIRED.
* ``AWS_REGION`` — region the stack is deployed in (defaults to ``us-east-1``).
* ``A2A_MACHINE_BEARER`` — a valid fraud-agent M2M OAuth2 access token. Needed for
  agent-card discovery, ``/ping``, and the permitted-research-tool invoke check.
* ``A2A_CUSTOMER_JWT`` — a valid customer Cognito user-pool JWT to forward as the
  ``identity_context``. Needed for the end-to-end fraud-hop invoke check.
* ``A2A_EXPIRED_BEARER`` — an expired machine bearer, for the authorizer-rejects
  case (6.3).
* ``AI_AGENT_ROLE_ARN`` — the ai_agent runtime execution role ARN, for the
  least-privilege IAM simulation (6.5).

Checks whose behavior lives in the Cedar policy-engine trace, the guardrail
trace, or the observability backend cannot be asserted programmatically without
standing up excessive log-scraping infrastructure. Those are authored as
explicit MANUAL-VERIFICATION steps: the test skips with a reason string that
describes exactly what to confirm, so the check is documented and discoverable
rather than a flaky assertion.

────────────────────────────────────────────────────────────────────────────
CDK deploy / destroy lifecycle checklist (Requirements 1.5, 11.2, 11.3)
────────────────────────────────────────────────────────────────────────────
The A2A feature must deploy and reset with only the standard CDK commands — no
manual scripts, no orphaned resources. Verify the following by hand in a dev/CI
account when validating a release:

  DEPLOY (Req 11.2)
  [ ] `npx cdk deploy` (with `features.a2a` on) completes cleanly and creates
      the fraud-research runtime (`Runtime_fraud_research`), the fraud M2M
      Cognito client + secret, the scoped Cedar deny policy, and the SSM params
      `/<stack>/runtime_arn_fraud_research` and `/<stack>/fraud_agent_client_id`.
  [ ] The `ai_agent` runtime env carries `FRAUD_AGENT_RUNTIME_ARN`, and the
      frontend build sees `VITE_FRAUD_AGENT_ENABLED=true`.
  [ ] With `features.a2a_parallel_research` on, the section-researcher runtime
      (`RuntimeArn_section_researcher`) is also created; with it off, no
      section-researcher A2A resources are created (in-process fan-out remains).

  RESET WITHOUT REDEPLOY (Req 11.5 / guidelines)
  [ ] The demo can be re-run for a fresh user WITHOUT redeploying — session
      state is per-invocation (platform-injected session id) and synthetic data
      only; no stack mutation is needed to reset.

  DESTROY (Req 11.3)
  [ ] `npx cdk destroy` removes the fraud runtime, the fraud M2M client + its
      Secrets Manager secret, the Cedar policy, the DockerImageAsset ECR image,
      and every SSM param / CfnOutput above — leaving NO orphaned resources.
  [ ] Flipping either feature flag off returns to the proven in-process path
      with no code change, and the corresponding A2A resources are not deployed
      (Req 11.2/11.3 stay green in both flag states).

  SELF-CONTAINED (Req 11.1)
  [ ] No resource reaches an endpoint outside the demo account; all traffic is
      account-local (Gateway, Bedrock, Cognito, AgentCore).
"""

from __future__ import annotations

import os

import pytest
from a2a_client import (
    AGENT_CARD_PATH,
    SESSION_ID_HEADER,
    AgentCard,
    agent_card_url,
    runtime_invocation_url,
)

FRAUD_AGENT_RUNTIME_ARN = os.environ.get("FRAUD_AGENT_RUNTIME_ARN")
REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))

# The skill the fraud agent advertises; any other method/skill must be rejected.
FRAUD_SKILL_ID = "fraud_research_assessment"

# HTTP status codes the AgentCore JWT authorizer returns when it rejects a
# request at the runtime boundary, before the container runs (Req 6.2, 6.3).
REJECT_STATUSES = (401, 403)

# The whole module skips cleanly (not errors) unless a deployed runtime is named.
pytestmark = pytest.mark.skipif(
    not FRAUD_AGENT_RUNTIME_ARN,
    reason="requires a deployed A2A runtime (set FRAUD_AGENT_RUNTIME_ARN to run these smoke checks)",
)


# ─── Helpers ────────────────────────────────────────────────────────────────


def _require(var: str, what: str) -> str:
    """Return an env var value or skip THIS check with an explicit reason.

    Keeps the module un-skipped at collection (the ARN is present) while letting
    an individual check skip cleanly when its extra prerequisite is absent, with
    a reason string that says exactly what to provide.
    """
    value = os.environ.get(var)
    if not value:
        pytest.skip(f"set {var} to run this check ({what})")
    return value


def _http_get(url: str, *, headers: dict[str, str] | None = None, timeout: int = 30):
    """GET a URL with `requests`, imported lazily so collection never needs it."""
    import requests  # noqa: PLC0415 — deferred so the module imports/skips without requests

    return requests.get(url, headers=headers or {}, timeout=timeout)


# ─── 1.2 / 2.1 — the runtime serves the agent card and /ping on the A2A path ──


def test_agent_card_served_over_the_wire():
    """GET `/.well-known/agent-card.json` returns a valid, parseable card (1.2, 2.1)."""
    bearer = _require("A2A_MACHINE_BEARER", "valid fraud-agent M2M bearer for discovery")
    url = agent_card_url(FRAUD_AGENT_RUNTIME_ARN, region=REGION)
    assert url.endswith(AGENT_CARD_PATH)

    resp = _http_get(url, headers={"Authorization": f"Bearer {bearer}"})
    assert resp.status_code == 200, f"agent card discovery returned {resp.status_code}: {resp.text[:300]}"

    # Parsing through the production model enforces name/url/>=1 skill (Req 2.2/2.4).
    card = AgentCard.from_dict(resp.json())
    assert card.name, "agent card must declare a non-empty name"
    assert card.url, "agent card must declare a non-empty invocation url"
    assert card.skills, "agent card must advertise at least one skill"
    skill_ids = {str(skill.get("id")) for skill in card.skills}
    assert FRAUD_SKILL_ID in skill_ids, f"expected skill {FRAUD_SKILL_ID!r}, got {sorted(skill_ids)}"


def test_ping_endpoint_healthy():
    """GET `/ping` on the A2A invocation path reports the container healthy (1.2)."""
    bearer = _require("A2A_MACHINE_BEARER", "valid fraud-agent M2M bearer for /ping")
    ping_url = f"{runtime_invocation_url(FRAUD_AGENT_RUNTIME_ARN, region=REGION)}ping"

    resp = _http_get(ping_url, headers={"Authorization": f"Bearer {bearer}"})
    assert resp.status_code == 200, f"/ping returned {resp.status_code}: {resp.text[:300]}"


# ─── 6.2 / 6.3 — the JWT authorizer rejects bad machine bearers ───────────────


def test_missing_machine_bearer_rejected():
    """A request with NO Authorization header is rejected by the authorizer (6.2)."""
    url = agent_card_url(FRAUD_AGENT_RUNTIME_ARN, region=REGION)
    resp = _http_get(url)  # no Authorization header
    assert resp.status_code in REJECT_STATUSES, (
        f"missing bearer should be rejected with {REJECT_STATUSES}, got {resp.status_code}"
    )


def test_malformed_machine_bearer_rejected():
    """A syntactically invalid bearer is rejected before the container runs (6.3)."""
    url = agent_card_url(FRAUD_AGENT_RUNTIME_ARN, region=REGION)
    resp = _http_get(url, headers={"Authorization": "Bearer not-a-real-jwt"})
    assert resp.status_code in REJECT_STATUSES, (
        f"malformed bearer should be rejected with {REJECT_STATUSES}, got {resp.status_code}"
    )


def test_expired_machine_bearer_rejected():
    """An expired-but-well-formed bearer is rejected by the authorizer (6.3)."""
    expired = _require("A2A_EXPIRED_BEARER", "an expired machine bearer to prove exp is enforced")
    url = agent_card_url(FRAUD_AGENT_RUNTIME_ARN, region=REGION)
    resp = _http_get(url, headers={"Authorization": f"Bearer {expired}"})
    assert resp.status_code in REJECT_STATUSES, (
        f"expired bearer should be rejected with {REJECT_STATUSES}, got {resp.status_code}"
    )


# ─── 7.1 / 7.2 — Cedar allows research tools, denies write/PII for the fraud principal ──


def test_research_tools_permitted_end_to_end():
    """A full fraud hop returns a schema-valid assessment, proving Cedar permits research tools (7.1).

    A successful assessment can only be produced if the fraud principal was
    allowed to call the research tools (kb_search / web_search / data_sources)
    through the Gateway under Cedar. This is the programmatically-assertable half
    of Requirement 7.1; the deny half (7.2) is verified manually below.
    """
    import asyncio  # noqa: PLC0415 — deferred; only needed for the live invoke

    from a2a_client import consult_fraud_research  # noqa: PLC0415

    bearer = _require("A2A_MACHINE_BEARER", "valid fraud-agent M2M bearer for the invoke")
    customer_jwt = _require("A2A_CUSTOMER_JWT", "valid customer user-pool JWT to forward")

    applicant = {
        "applicant_id": "synthetic-applicant-001",
        "full_name": "Jordan Test",
        "dob": "1990-01-01",
        "declared_income": 82000,
        "requested_product": "checking",
    }
    result = asyncio.run(
        consult_fraud_research(
            applicant,
            user_id="smoke-user",
            customer_jwt=customer_jwt,
            bearer=bearer,
            runtime_arn=FRAUD_AGENT_RUNTIME_ARN,
            region=REGION,
        )
    )
    assert isinstance(result, dict), f"expected an assessment mapping, got {type(result).__name__}"
    assert result.get("assessment") in {"clear", "review", "flagged"}, (
        f"assessment must be clear|review|flagged, got {result.get('assessment')!r}"
    )
    assert result.get("acting_agent") == "fraud_research"


def test_cedar_denies_write_and_pii_tools_for_fraud_principal():
    """MANUAL: confirm Cedar denies open_account / retrieve_user_profile to the fraud principal (7.2)."""
    pytest.skip(
        "MANUAL VERIFICATION (Req 7.1/7.2 deny path): the Cedar decision lives in the policy-engine "
        "trace, not the A2A response body, so it is not asserted here. To verify: "
        "(1) with the fraud policy in ENFORCE, drive the fraud agent to attempt `open_account` and "
        "`retrieve_user_profile` and confirm each returns a Cedar DENY attributed to the fraud "
        "principal (the fraud M2M client id), while `kb_search`/`web_search`/`data_sources` are "
        "PERMITTED; (2) confirm the ai_agent principal is still PERMITTED `open_account` (the deny is "
        "scoped to the fraud principal only); (3) with the policy in LOG_ONLY, confirm the same two "
        "tools produce a 'would-deny' record in the policy-engine/CloudWatch trace rather than a hard "
        "deny. Reference: the scoped `deny_account_and_pii_tools` policy in lib/stacks/backend/index.ts."
    )


# ─── 7.3 — the guardrail is applied to the fraud agent's model calls ──────────


def test_guardrail_applied_to_fraud_model_calls():
    """MANUAL: confirm the Bedrock Guardrail is applied to the fraud agent's model calls (7.3)."""
    pytest.skip(
        "MANUAL VERIFICATION (Req 7.3): guardrail application is observable in the guardrail trace, "
        "not the assessment payload. To verify: (1) confirm the fraud runtime resolves the guardrail id/"
        "version from SSM (`/<stack>/guardrail_id`, `/<stack>/guardrail_version`) and that its model "
        "invocations pass `guardrailIdentifier`/`guardrailVersion`; (2) drive a prompt that trips a "
        "configured guardrail policy and confirm the model interaction is blocked/redacted and a "
        "guardrail intervention is recorded; (3) confirm that if the guardrail cannot be applied the "
        "model call is blocked entirely (Req 7.5 — covered programmatically by the fraud-handler "
        "property test), never issued ungoverned."
    )


# ─── 8.1 / 8.4 — one trace, two owners, one customer identity ─────────────────


def test_a2a_hop_lands_in_one_trace_two_owners():
    """MANUAL: confirm caller + callee spans share one trace, two owners, one identity (8.1, 8.4)."""
    pytest.skip(
        "MANUAL VERIFICATION (Req 8.1/8.4): trace topology is confirmed in the observability backend, "
        "not from the A2A client. To verify: after one account-opening fraud hop, open the trace in the "
        "AgentCore/OTEL backend and confirm (1) the A2A invocation appears as a distinct child step "
        "within the SAME customer-interaction trace (8.1); (2) the caller step is attributed to owner "
        "`ai_agent` and the callee step to owner `fraud_research` (8.2); (3) BOTH steps carry the same "
        "customer `sub` as the identity attribute (8.3); and (4) the fraud agent's processing spans are "
        "present in the backend (8.4). The caller also emits `a2a_call` start/end events the flow panel "
        "renders (Req 9)."
    )


# ─── 6.5 — least-privilege IAM: only the scoped InvokeAgentRuntime is allowed ──


def _simulate(iam_client, role_arn: str, action: str, resource_arn: str) -> str:
    """Return the simulated decision ('allowed' / 'implicitDeny' / 'explicitDeny')."""
    response = iam_client.simulate_principal_policy(
        PolicySourceArn=role_arn,
        ActionNames=[action],
        ResourceArns=[resource_arn],
    )
    return response["EvaluationResults"][0]["EvalDecision"]


def test_ai_agent_role_allows_only_scoped_invoke_agent_runtime():
    """The ai_agent role may InvokeAgentRuntime ONLY on the fraud runtime ARN (6.5)."""
    import boto3  # noqa: PLC0415 — deferred so the module imports/skips without boto3

    role_arn = _require("AI_AGENT_ROLE_ARN", "the ai_agent runtime execution role ARN for IAM simulation")
    iam = boto3.client("iam", region_name=REGION)
    action = "bedrock-agentcore:InvokeAgentRuntime"

    allowed = _simulate(iam, role_arn, action, FRAUD_AGENT_RUNTIME_ARN)
    assert allowed == "allowed", f"ai_agent role should be allowed {action} on the fraud runtime, got {allowed!r}"

    # Least privilege: the SAME action on a different runtime ARN must NOT be allowed.
    other_arn = FRAUD_AGENT_RUNTIME_ARN.rsplit("/", 1)[0] + "/some-other-runtime-xxxxxxxxxx"
    other = _simulate(iam, role_arn, action, other_arn)
    assert other != "allowed", (
        f"ai_agent role must NOT be allowed {action} on an unscoped runtime ({other_arn}); got {other!r}"
    )


# ─── Sanity: the module's own URL construction (runs whenever the module is un-skipped) ──


def test_discovery_url_shape_is_wellformed():
    """The discovery URL is built from the runtime ARN and ends at the well-known card path.

    A cheap guard that fails fast (before any network) if the runtime ARN is
    malformed, so the network checks above give clearer failures.
    """
    base = runtime_invocation_url(FRAUD_AGENT_RUNTIME_ARN, region=REGION)
    assert base.startswith(f"https://bedrock-agentcore.{REGION}.amazonaws.com/runtimes/")
    assert base.endswith("/invocations/")
    assert agent_card_url(FRAUD_AGENT_RUNTIME_ARN, region=REGION) == f"{base}{AGENT_CARD_PATH}"
    # The session-isolation header name is the one the caller attaches per invoke.
    assert SESSION_ID_HEADER == "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id"
