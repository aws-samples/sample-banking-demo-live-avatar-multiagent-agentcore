# Implementation Plan — A2A Agent Collaboration

## Overview

Tasks are ordered so the shared caller/callee logic and the new fraud-research
runtime land before the CDK infrastructure and frontend wire to them, and so the
headline capability (the cross-team fraud hop, gated by `features.a2a`) ships and
is proven before the higher-risk parallel-researcher conversion (gated by
`features.a2a_parallel_research`, default off). Both A2A paths are feature-flagged,
so the demo stays buildable and the proven in-process paths remain the fallback at
every step.

Property-based tests (Hypothesis for Python, fast-check for TypeScript) are written
alongside the pure-logic seams they cover; each references its design property using
the format `Feature: a2a-agent-collaboration, Property {n}: {text}` and runs ≥ 100
iterations. Integration/smoke checks that require a live platform (JWT authorizer,
Cedar enforcement, guardrails, trace capture, CDK lifecycle) are authored as tasks
but scoped as post-deploy checks per the design's Testing Strategy.

## Tasks

- [x]   1. Add the identity-context module and callee JWT verification (`patterns/utils/`)
    - Create `patterns/utils/identity_context.py` with `build_identity_context(customer_jwt) -> dict` (produces the on-the-wire `message.metadata` shape: `identity_context` = the verified customer JWT, `acting_agent` = caller id) and `read_identity_context(message) -> str | None` (extracts the forwarded assertion from an inbound A2A message).
    - Extend `patterns/utils/auth.py` with `verify_user_pool_jwt(token) -> dict` — fetch the Cognito user-pool JWKS, verify signature + issuer + `exp` + `aud`, return claims; raise a typed error on absent/invalid/expired/bad-signature (distinct from the existing signature-skipping `extract_user_id_from_token`). Cache JWKS per issuer.
    - Extend `patterns/utils/auth.py` with `get_agent_access_token(client_id_param, secret_param)` generalizing the existing M2M client-credentials flow so a caller can mint a token for an arbitrary configured client (fraud caller vs. shared machine client).
    - _Requirements: 5.1, 5.2, 5.4, 6.1, 6.3_

- [x]   2. Property tests for identity build/verify
    - Add Hypothesis tests in `test/python/test_a2a_identity_context.py`:
        - Property 5 — for any verified `sub` and any (forged/mismatched) model-supplied `user_id`, `build_identity_context` yields a `metadata.identity_context` that decodes to the verified `sub` and the model value never overrides it.
        - Property 7 — sign test JWTs with a local key/JWKS fixture; `verify_user_pool_jwt` accepts valid tokens and rejects missing/malformed/expired/wrong-signature.
    - _Requirements: 5.1, 5.2, 5.4_

- [x]   3. Implement the caller-side A2A client (`patterns/utils/a2a_client.py`)
    - Define the typed `A2AHopError` (`step="a2a"`, `kind ∈ {discovery,invoke,timeout,network,auth,tracing}`, `detail`, `halts_decision`) and `A2ADiscoveryError`.
    - `fetch_agent_card(runtime_arn, bearer) -> AgentCard` — GET `/.well-known/agent-card.json` through the runtime invocation URL (URL-encoded ARN); raise `A2ADiscoveryError` on any failure.
    - `invoke_a2a(card, message, *, bearer, identity_context, session_id) -> A2AResult` — build the Strands `A2AAgent` client from the discovered card, attach the machine `Authorization` bearer + the `identity_context` metadata, send JSON-RPC `message/send`; map every JSON-RPC/transport failure to `A2AHopError`, parse non-2xx bodies for the JSON-RPC `error`, and retry `-32054 RetryableConflictException` with short exponential backoff before failing.
    - `consult_fraud_research(applicant, *, user_id, customer_jwt, session_id)` — discovery strictly before invoke; a discovery/precondition failure raises with `halts_decision=true` and issues zero invocations; returns the assessment or raises.
    - Add an error-to-hop mapper helper that all failure paths funnel through.
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.4, 4.5, 6.1_

- [x]   4. Property tests for the A2A client
    - Add Hypothesis tests in `test/python/test_a2a_client.py` with a fake `A2AAgent` and fake card fetcher that record call order/timestamps:
        - Property 1 — round-trip an agent card: parse/serialize is equivalent, `name`/`url` non-empty, ≥ 1 skill, and endpoint extraction returns the card `url`.
        - Property 2 — discovery is issued strictly before any `message/send`, and the invoked endpoint equals the discovered card `url` (never a static value).
        - Property 3 — inject each failure mode (discovery/invoke/timeout/network/auth/tracing); assert `A2AHopError(step="a2a")` with the right `kind`, `halts_decision=true`, no success result, and zero invocations for discovery/precondition failures.
        - Property 4 — for any synthetic applicant, the built request carries the required applicant fields and a non-empty `Authorization` bearer.
    - _Requirements: 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.2, 4.4, 4.5, 6.1_

- [x]   5. Scaffold the fraud-research agent package (`patterns/fraud-research-agent/`)
    - Create the package with `fraud_research_agent.py`, `agent_card.py` (or inline `serve_a2a` config), `system_prompt.txt`, `Dockerfile`, `requirements.txt`.
    - `requirements.txt`: `strands-agents[a2a]`, `bedrock-agentcore`, `boto3`, plus the shared `utils` deps.
    - `Dockerfile`: `LINUX_ARM64`, copy `patterns/utils` into the image, install deps, expose 9000, entrypoint `python fraud_research_agent.py` (mirror the shape of existing runtime Dockerfiles).
    - `agent_card.py` declares `name: "Trinity Fraud & Research Agent"`, `description`, `version`, `preferredTransport: "JSONRPC"`, `defaultInputModes/OutputModes: ["text"]`, and exactly one skill `fraud_research_assessment` (single advertised skill is how unknown-capability requests are rejected).
    - `system_prompt.txt`: fraud/research analyst persona, synthetic-data-only, no external calls.
    - _Requirements: 1.1, 1.4, 1.5, 2.1, 2.2, 2.4, 6.4, 11.1, 11.4_

- [x]   6. Implement the fraud-research A2A server handler
    - In `fraud_research_agent.py`, build a Strands `Agent` (assessment over synthetic applicant data using research tools only — `kb_search`/`web_search`/`data_sources`), wrap it in `StrandsA2AExecutor`, and serve with `bedrock_agentcore.runtime.serve_a2a(...)` (provides `/ping`, agent-card serving, `AGENTCORE_RUNTIME_URL`, header propagation, port 9000).
    - On each request: read `metadata.identity_context` via `read_identity_context` and call `verify_user_pool_jwt`; reject with a JSON-RPC authorization error if absent/invalid/expired.
    - Bind the verified customer `sub` into a `UserScopeHook` so Gateway tool calls carry the propagated identity; authenticate the Gateway MCP client with the fraud agent's **own** M2M client via `get_agent_access_token`.
    - Reject any method/skill other than `fraud_research_assessment` with an authorization/validation error.
    - Wrap model calls in a guardrail-availability check that blocks the invocation (raises) if the guardrail cannot be applied.
    - Return a schema-valid assessment artifact (`assessment ∈ {clear,review,flagged}`, integer `risk_score`, `signals`, `rationale`, `acting_customer_sub`, `acting_agent: "fraud_research"`); tag spans with the customer `sub` and acting-agent id.
    - _Requirements: 1.3, 5.3, 5.5, 6.4, 7.4, 7.5, 8.4_

- [x]   7. Property tests for the fraud-research handler
    - Add Hypothesis tests in `test/python/test_fraud_research_agent.py` with the model and Gateway MCP client mocked:
        - Property 6 — a valid assertion binds the verified `sub` as the injected Gateway `user_id`; caller/callee span attributes carry that `sub` with owners `ai_agent`/`fraud_research`.
        - Property 7 — missing/malformed/expired/bad-signature `identity_context` returns an authorization error and never runs the assessment.
        - Property 8 — any method/skill other than `fraud_research_assessment` returns an authorization/validation error and never runs the assessment.
        - Property 9 — the Gateway access token is minted with the fraud agent's own client, distinct from the shared machine client.
        - Property 10 — when the guardrail cannot be applied, the model call is not issued and an error is returned.
        - Property 11 — for any valid synthetic applicant, the returned assessment is schema-valid.
        - Property 12 — two concurrently processed requests with distinct `sub` values never cross injected `user_id` values.
    - _Requirements: 1.3, 5.3, 5.4, 5.5, 6.4, 7.4, 7.5, 11.5_

- [x]   8. Wire the fraud-hop caller into the orchestrator (`patterns/orchestrator-agent/orchestrator_agent.py`)
    - In the `ai_agent` chatbot path, expose a `consult_fraud_research` Strands `@tool` the agent calls at the KYC/fraud step; the tool delegates to `a2a_client.consult_fraud_research`.
    - Inject the customer identity **server-side via a hook** (same pattern as `UserScopeHook`) derived from `extract_user_id_from_context`/the verified JWT — never from tool arguments the model produced.
    - Return the assessment for the model to incorporate into the account-opening decision; on discovery/invoke/tracing failure surface an error state that names the A2A hop and halts the dependent decision.
    - Emit `a2a_call` stream events `{"a2a_call": {"agent": "fraud_research", "phase": "collaboration", "status": "start|end|error", "identity_forwarded": true}}` alongside existing telemetry.
    - Open the A2A child span before invoking; if the trace context cannot be established, raise `A2AHopError(kind="tracing", halts_decision=true)` and do not invoke.
    - Gate the whole fraud step behind `features.a2a`.
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 5.1, 5.2, 8.1, 8.5, 9.1_

- [x]   9. Example/edge tests for the fraud-hop caller
    - Add `test/python/test_fraud_hop_caller.py`: the KYC step triggers exactly one A2A invoke (4.1); the returned assessment is placed in the decision context (4.3); the server-side identity hook overrides any model-supplied `user_id`; boundary inputs (empty applicant, oversized payload, clock-skewed token) map to the correct `A2AHopError`.
    - _Requirements: 4.1, 4.3, 5.2_

- [x]   10. Add the fraud runtime infrastructure and auth (`lib/stacks/backend/index.ts`, `lib/stacks/auth`, `agentcore-role.ts`)
    - Add feature flags to `lib/common/feature-flags.ts`: `a2a` (default `true`), `a2a_parallel_research` (default `false`); surface in `cdk.json`.
    - New `DockerImageAsset` for the fraud Dockerfile (`LINUX_ARM64`) and a new `CfnRuntime` `Runtime_fraud_research` with `protocolConfiguration: "A2A"`, `networkConfiguration.networkMode: "PUBLIC"`, `authorizerConfiguration.customJwtAuthorizer` (`allowedClients: [fraudMachineClient]`, `discoveryUrl`), `requestHeaderConfiguration.requestHeaderAllowlist: ["Authorization"]`; env: fraud M2M client id/secret params, gateway URL, memory id, stack name, Cognito issuer. Gate on `features.a2a`.
    - Add a new Cognito app client (client-credentials) in the Auth stack with its own gateway resource-server scopes; add it to the Gateway `allowedClients` so the fraud agent reaches the Gateway as a distinct principal.
    - Scope the Cedar `deny_account_and_pii_tools` policy (or add a companion) so the `forbid` binds `principal == <fraud principal>` for `open_account` / `retrieve_user_profile`, keeping the baseline permit for research tools and leaving the AI Agent's `open_account` access intact.
    - In `agentcore-role.ts`: grant the `ai_agent` runtime `bedrock-agentcore:InvokeAgentRuntime` scoped to the fraud runtime ARN (least privilege); grant the fraud runtime the research-tool/model/guardrail permissions the orchestrator role has, minus anything not needed for assessment.
    - Add SSM param + `CfnOutput` for the fraud runtime ARN; pass `FRAUD_AGENT_RUNTIME_ARN` into the `ai_agent` runtime env; expose `VITE_FRAUD_AGENT_ENABLED` to the frontend.
    - _Requirements: 1.1, 1.5, 6.2, 6.5, 7.2, 7.4, 11.2, 11.3_

- [x]   11. Add the `a2a_call` stream event to the frontend agentcore client
    - `lib/stacks/frontend/app/.../agentcore-client/types.ts`: add the `a2a_call` `StreamEvent` (`{ type: "a2a_call"; agent: AgentId; phase: "collaboration"; status: "start" | "end" | "error"; identityForwarded: boolean }`) and add `"fraud_research"` to `AgentId`.
    - `parsers/strands.ts`: parse `json.a2a_call` into the event.
    - _Requirements: 9.1, 9.2, 9.4_

- [x]   12. Add A2A state to the flow store and chat engine
    - `stores/conciergeFlowStore.ts`: add `a2a` state (`status`, `identityForwarded`) with actions `a2aStart/a2aEnd/a2aError`, cleared on `reset`.
    - `hooks/useChatEngine.ts`: add a `case "a2a_call"` that drives the store (respecting the existing `react-hooks/set-state-in-effect` / purity constraints — never setState synchronously in an effect body).
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x]   13. Render the A2A step in the flow panel
    - `components/concierge-flow/ConciergeFlowDiagram.tsx` + `flow-types.ts`: add a distinct "Fraud Research Agent" node (category `a2a`) with an edge from the runtime labeled "A2A collaboration", an identity-carried indicator, and idle/active/completed/failed states; render only when `VITE_FRAUD_AGENT_ENABLED`.
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x]   14. Property + snapshot tests for the frontend A2A step
    - Add fast-check tests in `test/typescript/a2aFlow.test.ts`:
        - Property 16 — for any `a2a_call` SSE payload, `parseStrandsChunk` emits a well-formed event; a `start → end` sequence drives the store to `completed`, an `error` status to `failed`, and `identityForwarded=true` sets the identity-carried indicator (store MAY stay in-progress until the terminal event).
    - Snapshot-test the new `ConciergeFlowDiagram` A2A node.
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x]   15. Convert the parallel section researchers to A2A (gated, `features.a2a_parallel_research`)
    - Add an A2A dispatch branch in `_run_parallel_research` (in `orchestrator_agent.py`) that replaces per-worker in-process sub-agents with A2A invocations (reusing `a2a_client`) to a section-researcher A2A runtime, forwarding the same customer `identity_context`.
    - Preserve the existing merge, per-section-failure-continue, telemetry-only tool-event behavior, and the two-tier watchdog (`WORKER_IDLE_TIMEOUT_SEC` 180s idle + `PARALLEL_PHASE_WALL_CLOCK_SEC` 900s wall clock) wrapping the A2A dispatch.
    - Require true concurrency: dispatch all N section invocations before awaiting any; if the concurrency primitive is unavailable (executor/event loop with capacity ≥ 2), raise `ConcurrencyUnavailableError` and never degrade to sequential.
    - Reuse the existing per-worker researcher JSON result shape so the merge logic is unchanged. Gate the branch on `features.a2a_parallel_research`; keep the in-process path as the fallback when off.
    - Add the section-researcher A2A runtime infra behind the same flag (mirror task 10's runtime pattern; reuse the fraud caller or a section-researcher M2M client per least privilege).
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 12.2_

- [x]   16. Property tests for the fan-out dispatcher and merge
    - Add Hypothesis tests in `test/python/test_a2a_fan_out.py` with the A2A client mocked:
        - Property 13 — for N ≥ 2 shards, exactly N invocations are issued (one per shard) and all N start before any completes (concurrency overlap).
        - Property 14 — for any mix of successful/failed section invocations, the merged set is exactly the union of successes, every failure is reported, and no single failure aborts the merge.
        - Property 15 — when the concurrency primitive is unavailable, the dispatcher raises `ConcurrencyUnavailableError` and never runs sections sequentially.
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6_

- [x]   17. Post-deploy integration/smoke checks (authored, not property tests)
    - Add a small `test/python/integration/test_a2a_smoke.py` (skipped unless a runtime ARN env var is present) with 1–3 examples each: the runtime serves `/.well-known/agent-card.json` and `/ping` on the A2A path (1.2, 2.1); the JWT authorizer rejects missing/invalid/expired machine bearers (6.2, 6.3); Cedar denies the fraud principal the write/PII tools while allowing research tools under ENFORCE and records would-deny under LOG_ONLY (7.1, 7.2); the guardrail is applied to the fraud agent's model calls (7.3); both agents' spans land in one trace attributed to two owners with one identity (8.1, 8.4); least-privilege IAM allows only the scoped `InvokeAgentRuntime` (6.5).
    - Document the CDK deploy/destroy lifecycle expectation (no orphaned resources) as a checklist in the test module docstring (1.5, 11.2, 11.3).
    - _Requirements: 1.2, 2.1, 6.2, 6.3, 6.5, 7.1, 7.2, 7.3, 8.1, 8.4, 11.2, 11.3_

## Task Dependency Graph

```json
{
    "waves": [
        { "wave": 1, "tasks": ["1"] },
        { "wave": 2, "tasks": ["2", "3", "5"] },
        { "wave": 3, "tasks": ["4", "6"] },
        { "wave": 4, "tasks": ["7", "8"] },
        { "wave": 5, "tasks": ["9", "10"] },
        { "wave": 6, "tasks": ["11", "15"] },
        { "wave": 7, "tasks": ["12", "16"] },
        { "wave": 8, "tasks": ["13", "17"] },
        { "wave": 9, "tasks": ["14"] }
    ]
}
```

```
1 (identity_context + auth verify/token)
├─▶ 2 (PBT identity)
├─▶ 3 (a2a_client) ─▶ 4 (PBT a2a_client)
├─▶ 5 (scaffold fraud pkg) ─┐
└─────────────────────────▶ 6 (fraud A2A server handler)  [needs 1 + 5]
                             └─▶ 7 (PBT fraud handler)

3, 1 ─▶ 8 (fraud-hop caller in orchestrator)
        └─▶ 9 (edge tests caller)

6, 8 ─▶ 10 (fraud runtime infra + auth + feature flags)
        └─▶ 11 (frontend a2a_call event type)
             └─▶ 12 (flow store + chat engine)
                  └─▶ 13 (flow-panel A2A node)
                       └─▶ 14 (PBT + snapshot frontend)

3, 10 ─▶ 15 (parallel researchers to A2A — gated)
         └─▶ 16 (PBT fan-out/merge/concurrency)

10, 15 ─▶ 17 (post-deploy integration/smoke checks)
```

The fraud-hop track (1→3→8→10→11→12→13→14) is the headline capability and lands
first. The parallel-researcher track (15→16) is independent and gated off by
default, so it can be deferred without blocking the fraud story.

## Notes

- **Feature-flag sequencing.** Tasks 1–14 deliver the headline fraud hop under `features.a2a` (default on). Tasks 15–16 deliver the higher-risk parallel-researcher conversion under `features.a2a_parallel_research` (default off). The two are independent; the fraud story ships without touching the proven in-process fan-out.
- **Test-first at the pure seams.** Each property task follows the implementation task it validates so the seam exists to test against. All 16 properties run fully mocked (no deploy) per the design's Testing Strategy; Hypothesis for Python, fast-check for TypeScript, ≥ 100 iterations, tagged with the design property text.
- **What is deliberately out of the coding plan.** CDK `deploy`/`destroy`, live JWT-authorizer/Cedar/guardrail/trace behavior, and demo walkthroughs are verification activities, not coding tasks. Task 17 authors the smoke checks as skipped-by-default integration tests so they are runnable in a dev/CI account without being actionable manual steps here.
- **Validation commands.** Python: `python3 -m py_compile <file>`, `ruff check <paths>`, `./.venv/bin/pytest test/python -q`. CDK: `npx tsc --noEmit -p tsconfig.json`. Frontend (from `lib/stacks/frontend/app`): `npx tsc -b`, `npx eslint <files>`, `npm run build`. TS tests: `npx jest test/typescript/<file>`.
- **Constraints carried from steering/design.** Synthetic data only; no external endpoints; never setState synchronously in an effect body (`react-hooks/set-state-in-effect` + purity enforced); the fraud hop halts the dependent decision on any A2A failure rather than fabricating a result.
