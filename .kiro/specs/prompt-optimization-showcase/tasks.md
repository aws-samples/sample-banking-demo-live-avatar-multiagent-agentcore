# Implementation Plan — Prompt Optimization Showcase

## Overview

Tasks are ordered so the pure, fully-testable backend seams land first
(`optimize_targets.py` registry/validator/request-builder, then the
Bedrock-event → `prompt_opt` mapper), then the streaming `_handle_optimize_prompt`
handler that consumes them, then the before/after `_handle_optimize_sample` runner
and the router changes that expose both new modes and the chatbot
`system_prompt_override` passthrough. Only after the backend proves out do the CDK
infrastructure (flag, IAM grant, runtime/frontend env) and the frontend
(stream event, store, chat-engine apply, Showcase_Card, flow-panel node) wire to
it. The whole feature is gated by `features.prompt_optimization` (default off), so
the AI Agent's proven `mode="chatbot"` path stays the fallback at every step and
the demo remains buildable, deployable, and destroyable with standard CDK commands.

Property-based tests (Hypothesis for Python, fast-check for TypeScript) are written
alongside the pure-logic seams they cover; each references its design property using
the format `Feature: prompt-optimization-showcase, Property {n}: {text}` and runs
≥ 100 iterations. Integration/smoke checks that require live AWS (live
`OptimizePrompt`, the IAM grant, the guardrail on a sample run, and `cdk synth`) are
authored as skipped-by-default, env-guarded tasks per the design's Testing Strategy —
they are not property tests.

## Tasks

- [ ]   1. Backend target-model registry, validator, and request builder (`patterns/orchestrator-agent/optimize_targets.py`, NEW)
    - [ ] 1.1 Implement the pure `optimize_targets.py` module
        - Define `TargetModel(NamedTuple)` (`optimize_target_id`, `invoke_id`, `label`) and `SUPPORTED_TARGET_MODELS` with exactly the three verified entries (Claude Sonnet 4.5, Claude Haiku 4.5, Claude 3 Haiku), each recording the foundation-model `optimize_target_id` and its invocable `invoke_id`.
        - Implement `is_inference_profile_id(model_id)` — `True` for inference-profile-form ids (e.g. `us.`/`eu.`/`apac.` prefixed) that `OptimizePrompt` rejects.
        - Implement `validate_optimize_targets(requested)` returning `ValidationResult{ submit, invalid }`: partition into `submit` (⊆ supported foundation-model ids, foundation-model form, de-duplicated, capped at 3) and `invalid` (`InvalidTarget{ id, reason: "inference_profile" | "unsupported" }`); never return an inference-profile id in `submit`, and never include the Current_Model profile.
        - Implement `build_optimize_request(prompt_text, target)` returning `{"input": {"textPrompt": {"text": prompt_text}}, "targetModelId": target.optimize_target_id}` — always the foundation-model id, never `invoke_id`; one request per target.
        - Keep the module pure (no boto3, no I/O) so it is fully unit/property testable.
        - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 13.1_

    - [ ]\* 1.2 Property test the validator and request builder (`test/python/test_optimize_targets.py`)
        - **Feature: prompt-optimization-showcase, Property 1: Optimization submits only supported foundation-model targets, never a profile id** — generate id lists mixing supported FM ids, `us./eu./apac.`-prefixed profile ids (including the Current_Model profile), unsupported ids, and duplicates; assert `submit` has no inference-profile id, `submit ⊆` supported FM ids, `len ≤ 3`, de-duplicated, and each dropped profile id appears in `invalid` with reason `inference_profile`.
        - **Feature: prompt-optimization-showcase, Property 2: The OptimizePrompt request carries the current prompt text and a foundation-model target** — generate prompt text × supported target; assert `input.textPrompt.text` equals the exact prompt text, `targetModelId` equals the target's foundation-model id (never its `invoke_id`), and exactly one request is planned per submitted target.
        - Hypothesis, ≥ 100 iterations.
        - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4_

- [ ]   2. Backend optimize-prompt streaming handler and event mapper (`patterns/orchestrator-agent/`)
    - [ ] 2.1 Implement the pure Bedrock-event → `prompt_opt` mapper in `optimize_targets.py`
        - Add `map_optimize_event(event, target_model_id, model_label)` that maps one Bedrock stream item to a `prompt_opt` dict: `event["analyzePromptEvent"]["message"]` → `kind="analysis"`; `event["optimizedPromptEvent"]["optimizedPrompt"]["textPrompt"]["text"]` → `kind="optimized"`; preserving `target_model_id` and `text`.
        - Keep it pure (no boto3) so the mapper is property-testable in isolation.
        - _Requirements: 3.1, 3.2_

    - [ ]\* 2.2 Property test the event mapper (`test/python/test_optimize_event_mapper.py`)
        - **Feature: prompt-optimization-showcase, Property 3: Bedrock optimize events map to typed events preserving kind, model, and text** — generate sequences of `analyzePromptEvent`/`optimizedPromptEvent` items with arbitrary text for an arbitrary Target_Model; assert the mapper emits, in order, one `prompt_opt` event per item whose `kind` is `analysis`/`optimized` respectively, whose `target_model_id` equals the source model id, and whose `text` equals the source message/optimized prompt.
        - Hypothesis, ≥ 100 iterations.
        - _Requirements: 3.1, 3.2_

    - [ ] 2.3 Implement `_handle_optimize_prompt` in `orchestrator_agent.py`
        - Async generator (same shape as `_handle_chatbot`) that defaults `prompt_text` to `CHATBOT_PROMPT` (the Current_System_Prompt); the client never supplies prompt content.
        - Emit once a `{"_ui": {"component": "PromptOptimizationShowcase", "props": {...baseline...}}}` segment so the card mounts with the Baseline_Variant prompt, and a `prompt_opt` `kind="step_start"` event for the flow panel.
        - Run `validate_optimize_targets(SUPPORTED_TARGET_MODELS)`; emit a `prompt_opt` `kind="invalid_target"` for each dropped id.
        - For each surviving `TargetModel`, create `boto3.client("bedrock-agent-runtime")`, call `optimize_prompt(**build_optimize_request(prompt_text, tm))`, iterate `response["optimizedPrompt"]`, and emit each item via `map_optimize_event`.
        - Wrap each model in `try/except`: `ValidationException` naming an invalid target → `kind="invalid_target"`; any other error (incl. `AccessDeniedException`) → `kind="error"`; either way continue to the next model. After the loop emit `kind="step_complete"`, or `kind="step_failed"` when no model reached `optimized`.
        - Use the shared AgentCore execution role; call only in-account Bedrock.
        - _Requirements: 1.1, 1.4, 2.2, 3.1, 3.2, 3.5, 4.1, 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 10.3, 10.4, 11.2, 12.3, 13.1_

- [ ]   3. Backend before/after runner, router branches, and chatbot passthrough (`patterns/orchestrator-agent/orchestrator_agent.py`)
    - [ ] 3.1 Extend the router and the chatbot branch
        - Read `_ENABLE_PROMPT_OPTIMIZATION` from the `ENABLE_PROMPT_OPTIMIZATION` env var (mirroring `_ENABLE_A2A`).
        - Extend the existing `mode="chatbot"` branch to read `system_prompt_override = payload.get("system_prompt_override") or None` and pass it through to `_handle_chatbot` (it already passes `model_id` → `requested_model`).
        - Add flag-gated `mode="optimize_prompt"` and `mode="optimize_sample"` branches delegating to the new handlers; when the flag is off both fall through to the existing default handling (benign error event) so the AI Agent operates exactly as today.
        - _Requirements: 1.5, 8.1, 8.2, 8.3, 12.2, 13.2_

    - [ ] 3.2 Implement `_handle_optimize_sample` in `orchestrator_agent.py`
        - Async generator that runs the synthetic Sample_Question through `_handle_chatbot` twice: once as Baseline (Current_Model, no override) tagging events `variant="baseline"` with the Baseline Provenance_Label; once as the Candidate (`requested_model=candidate_invoke_id`, `system_prompt_override=candidate_prompt`) tagging events `variant="candidate"` with the Candidate Provenance_Label.
        - Wrap each run so a failure emits a `prompt_opt` `kind="sample_error"` for that variant while the other run still streams.
        - Use a throwaway `session_id` suffix so the comparison does not pollute live conversation memory; the Sample_Question is synthetic.
        - _Requirements: 7.1, 7.2, 7.4, 7.5, 7.6, 12.4, 13.2_

    - [ ]\* 3.3 Example/integration tests for the handlers (`test/python/test_optimize_handlers.py`)
        - With the Bedrock client and `_handle_chatbot` model mocked: `_handle_optimize_prompt` submits only `CHATBOT_PROMPT` text and never another agent phase's prompt (13.1); the apply path routes only through `mode="chatbot"` with `model_id`/`system_prompt_override` and introduces no other invocation path (13.2); `_handle_optimize_sample` invokes `_handle_chatbot` once per side with the correct `requested_model`/`system_prompt_override` (7.1, 7.2, 7.4).
        - _Requirements: 7.1, 7.2, 7.4, 13.1, 13.2_

- [ ]   4. Checkpoint — backend seams verified
    - Ensure all tests pass, ask the user if questions arise. Validate with `python3 -m py_compile patterns/orchestrator-agent/optimize_targets.py patterns/orchestrator-agent/orchestrator_agent.py`, `ruff check patterns/orchestrator-agent`, and `./.venv/bin/pytest test/python -q`.

- [ ]   5. CDK infrastructure (flag-gated)
    - [ ] 5.1 Add the `prompt_optimization` feature flag
        - Add `prompt_optimization: boolean` (default `false`) to `FeatureFlags` in `lib/common/feature-flags.ts` and a corresponding `cdk.json` context entry.
        - _Requirements: 12.1_

    - [ ] 5.2 Grant `bedrock:OptimizePrompt` on the AgentCore role (`lib/stacks/backend/agentcore-role.ts`)
        - Add `bedrock:OptimizePrompt` to the existing Bedrock `PolicyStatement` (or a companion statement), conditional on `features.prompt_optimization`, using the shared AgentCore_Role with least privilege. No new role.
        - _Requirements: 11.1, 11.3_

    - [ ] 5.3 Wire runtime and frontend env (`lib/stacks/backend/index.ts`, `lib/stage.ts`)
        - Set `ENABLE_PROMPT_OPTIMIZATION` on the orchestrator runtime env from `features.prompt_optimization` (mirroring `ENABLE_A2A`), and expose `VITE_PROMPT_OPTIMIZATION_ENABLED` to the frontend build.
        - _Requirements: 1.5, 11.2, 12.2, 12.5_

- [ ]   6. Frontend stream event, parser, and per-model store (`lib/stacks/frontend/app/src/`)
    - [ ] 6.1 Add the `prompt_opt` stream event and parser
        - `lib/agentcore-client/types.ts`: add the `prompt_opt` `StreamEvent` (`type`, `targetModelId`, `modelLabel`, `kind` ∈ `step_start|analysis|optimized|in_progress|error|invalid_target|step_complete|step_failed|sample|sample_error`, `text`, optional `variant`, optional `optimizedForModelId`).
        - `parsers/strands.ts`: add a `json.prompt_opt` branch (mirroring `a2a_call`) mapping snake_case backend fields to the typed camelCase event.
        - _Requirements: 3.1, 3.2, 9.1_

    - [ ] 6.2 Implement `usePromptOptimizationStore`
        - Zustand store holding `models` (per-`targetModelId` `ModelPanel`), `baselinePrompt`, `selected` (`SelectedVariant | null`), and `sample`, with `applyEvent(prompt_opt)`, `select(variant)`, and `clear()`.
        - `applyEvent` folds each model's own events independently (`in_progress`→`succeeded` on optimized, `failed` on error, `invalid_target` on invalid) and records analysis/optimized text; expose a selector deriving the applied `(model_id, system_prompt_override)` from `selected` (none/baseline → nothing; candidate → `invoke_id` + Optimized_Prompt) and a before/after pairing view.
        - _Requirements: 3.3, 3.4, 3.5, 6.1, 6.2, 6.3, 6.4, 7.3, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 10.1, 10.2, 10.3, 10.4, 10.5, 12.6_

    - [ ]\* 6.3 Property test the per-model fold (`test/typescript/promptOptStore.test.ts`)
        - **Feature: prompt-optimization-showcase, Property 4: The per-model fold reflects each model's own outcome independently** — generate `prompt_opt` sequences over any set of Target_Models with mixed outcomes; assert each panel reflects only its own events (optimized→`succeeded` with analysis+prompt, error→`failed`, invalid→`invalid_target`, none→`in_progress`), the selectable Candidate_Variants equal exactly the `succeeded` models, and no model's outcome alters another's panel.
        - fast-check, ≥ 100 iterations.
        - _Requirements: 3.3, 3.4, 3.5, 10.1, 10.2, 10.3, 10.4, 10.5_

    - [ ]\* 6.4 Property test the selection → applied-config mapper (`test/typescript/promptOptApply.test.ts`)
        - **Feature: prompt-optimization-showcase, Property 6: Selection maps to the correct applied per-request configuration** — generate selection states; assert no candidate model and no `system_prompt_override` when nothing/Baseline is selected, and the candidate's `invoke_id` as `model_id` plus its Optimized_Prompt as `system_prompt_override` when a Candidate is selected.
        - fast-check, ≥ 100 iterations.
        - _Requirements: 6.1, 6.2, 6.3, 6.4, 8.1, 8.2, 8.3_

    - [ ]\* 6.5 Property test per-session isolation (`test/typescript/promptOptIsolation.test.ts`)
        - **Feature: prompt-optimization-showcase, Property 7: Applied configuration is isolated per session** — instantiate two independent store instances with distinct selections; assert the applied `(model, prompt-override)` derived from one is a function of its own selection alone and never depends on or changes the other.
        - fast-check, ≥ 100 iterations.
        - _Requirements: 8.4, 12.6_

    - [ ]\* 6.6 Property test the before/after pairing (`test/typescript/promptOptSample.test.ts`)
        - **Feature: prompt-optimization-showcase, Property 8: Before/after pairs answers with provenance and isolates a per-variant failure** — generate the four outcome combinations (each side answers or fails) with random answer text; assert each present answer is labeled with its Variant's Provenance_Label, a failed side shows a failure state, and the other side's answer still shows whenever it succeeded.
        - fast-check, ≥ 100 iterations.
        - _Requirements: 7.3, 7.5, 7.6_

- [ ]   7. Frontend chat-engine apply wiring and Showcase_Card (`lib/stacks/frontend/app/src/`)
    - [ ] 7.1 Add `case "prompt_opt"` and the apply passthrough in `hooks/useChatEngine.ts`
        - Dispatch `prompt_opt` events into `usePromptOptimizationStore` and the concierge flow store (respecting `react-hooks/set-state-in-effect` / purity — never setState synchronously in an effect body).
        - In `sendMessage`, for `mode="chatbot"`, read the store's `selected` and attach `{ model_id: candidate.invokeId, system_prompt_override: candidate.optimizedPrompt }` for a candidate, and nothing for baseline; clear the selection on `startNewChat`/reload.
        - _Requirements: 6.2, 8.1, 8.2, 8.3, 8.4, 13.2, 13.3_

    - [ ] 7.2 Implement `PromptOptimizationCard.tsx` and register it (`components/chat/`)
        - Create `components/chat/PromptOptimizationCard.tsx` rendering from `usePromptOptimizationStore`: Baseline_Variant prompt labeled "Current configuration"; per-model streaming analysis then optimized prompt with in-progress/succeeded/failed/invalid-target states distinguished; each Candidate labeled by the model its prompt was optimized for (mismatch label when paired otherwise); no Bedrock-attributed score/latency/cost, heuristics labeled "heuristic", before/after results attributed to this demo's own sample run; Baseline + each successful Candidate selectable, an inert-until-selected Apply affordance, a "Run sample question" affordance triggering `mode="optimize_sample"`, and a display of which Variant is applied.
        - Extract the provenance/attribution label derivation into a pure importable helper (e.g. `deriveVariantView`) so it is property-testable.
        - Register the card as `PromptOptimizationShowcase` in `components/chat/ui-components.ts`, analogous to `ServicesCatalogCard`.
        - _Requirements: 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 6.1, 6.2, 7.3, 8.5, 10.2, 10.3, 10.5_

    - [ ]\* 7.3 Property test the provenance/attribution labeler (`test/typescript/promptOptProvenance.test.ts`)
        - **Feature: prompt-optimization-showcase, Property 5: Provenance and attribution labels are correct and never claim Bedrock scores** — generate Variants × paired models and store states; assert the Baseline is labeled the current configuration, a Candidate is identified by its optimized-for model, a candidate paired with a different model yields a mismatch label naming both models, and the derived view exposes no Bedrock-attributed score/latency/cost, labels non-before/after indicators as heuristics, and attributes before/after results to the feature's own sample generation.
        - fast-check, ≥ 100 iterations.
        - _Requirements: 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3_

    - [ ]\* 7.4 Snapshot test the Showcase_Card (`test/typescript/promptOptCard.test.tsx`)
        - Render the card with baseline + one succeeded candidate present and snapshot it, asserting baseline and candidate blocks and the applied-variant display render.
        - _Requirements: 4.1, 4.2, 8.5_

- [ ]   8. Frontend flow-panel node (`lib/stacks/frontend/app/src/`)
    - [ ] 8.1 Add the `promptOpt` lifecycle to the flow store and types
        - `stores/conciergeFlowStore.ts`: add `promptOpt: { status: "idle"|"active"|"completed"|"failed" }` with actions `promptOptStart/promptOptComplete/promptOptFail`, cleared on `reset`.
        - `flow-types.ts`: add category `"prompt_opt"` (reusing the `failed`-capable `NodeActivity`) and a `CORE_NODE_META.prompt_optimization` entry.
        - Fold rule: `step_start`→`active`, applying a Selected_Variant→`completed`, all-targets-failed→`failed`; MAY remain `active` until a terminal event.
        - _Requirements: 9.1, 9.2, 9.3, 9.4_

    - [ ] 8.2 Render the Prompt Optimization node (`components/concierge-flow/ConciergeFlowDiagram.tsx`)
        - Add a distinct "Prompt Optimization" node (category `prompt_opt`) driven by `promptOpt.status` with idle/active/completed/failed states; render only when `VITE_PROMPT_OPTIMIZATION_ENABLED`.
        - _Requirements: 9.1, 9.2, 9.3, 9.4_

    - [ ]\* 8.3 Property test the flow-node status fold (`test/typescript/promptOptFlow.test.ts`)
        - **Feature: prompt-optimization-showcase, Property 9: The flow-panel step folds to the correct lifecycle state** — generate prompt-optimization lifecycle sequences; assert `step_start` drives `active`, applying a Selected_Variant drives `completed`, an all-targets-failed terminal drives `failed`, and the node MAY remain `active` until a terminal event.
        - fast-check, ≥ 100 iterations.
        - _Requirements: 9.1, 9.2, 9.3, 9.4_

    - [ ]\* 8.4 Snapshot test the flow node (`test/typescript/promptOptFlow.test.ts`)
        - Snapshot the new `ConciergeFlowDiagram` Prompt Optimization node in its active and completed states.
        - _Requirements: 9.1_

- [ ]   9. Checkpoint — frontend build and tests verified
    - Ensure all tests pass, ask the user if questions arise. Validate from `lib/stacks/frontend/app` with `npx tsc -b`, `npx eslint <files>`, `npm run build`, and `npx jest test/typescript/<file>`; validate CDK with `npx tsc --noEmit -p tsconfig.json` and `npx cdk synth`.

- [ ]   10. Skipped-by-default smoke / integration checks (env-guarded, not property tests)
    - [ ]\* 10.1 Live `OptimizePrompt` smoke (`test/python/integration/test_optimize_smoke.py`)
        - Skipped unless `RUN_LIVE_OPTIMIZE=1`: for each of the three verified foundation-model ids in `us-east-1`, assert the stream yields an `analyzePromptEvent` then an `optimizedPromptEvent`, and assert an inference-profile id is rejected.
        - _Requirements: 2.1, 2.3, 2.4_

    - [ ]\* 10.2 IAM grant presence assertion (`test/typescript/promptOptIam.test.ts`)
        - CDK assertion that the AgentCore_Role policy includes `bedrock:OptimizePrompt` with the flag on and omits it with the flag off.
        - _Requirements: 11.1, 11.3_

    - [ ]\* 10.3 Guardrail-on-sample-run check (`test/python/integration/test_optimize_smoke.py`)
        - Skipped unless the live guard env var is present: assert a sample run still has the guardrail applied (self-contained safety check).
        - _Requirements: 12.3_

    - [ ]\* 10.4 `cdk synth` flag on/off check (`test/typescript/promptOptSynth.test.ts`)
        - Assert `cdk synth` with the flag on and off produces a clean template with no external endpoints, confirming self-contained deploy/destroy.
        - _Requirements: 12.1, 12.2, 12.3, 12.5_

## Task Dependency Graph

```json
{
    "waves": [
        { "wave": 1, "tasks": ["1.1", "5.1", "6.1", "6.2", "8.1"] },
        {
            "wave": 2,
            "tasks": [
                "1.2",
                "2.1",
                "5.2",
                "5.3",
                "6.3",
                "6.4",
                "6.5",
                "6.6",
                "7.1",
                "7.2",
                "8.2",
                "8.3"
            ]
        },
        { "wave": 3, "tasks": ["2.3", "7.3", "7.4", "8.4"] },
        { "wave": 4, "tasks": ["3.1"] },
        { "wave": 5, "tasks": ["3.2"] },
        { "wave": 6, "tasks": ["3.3", "10.1", "10.2", "10.3", "10.4"] }
    ]
}
```

```
1.1 (optimize_targets.py: registry + validator + request builder)
├─▶ 1.2* (PBT Properties 1, 2)
├─▶ 2.1 (event mapper, pure) ─▶ 2.2* (PBT Property 3)
│                             └─▶ 2.3 (_handle_optimize_prompt)  [needs 1.1 + 2.1]
│                                  └─▶ 3.1 (router branches + chatbot passthrough)
│                                       └─▶ 3.2 (_handle_optimize_sample)
│                                            └─▶ 3.3* (example/integration tests)  [needs 2.3 + 3.1 + 3.2]

5.1 (feature flag + cdk.json)
├─▶ 5.2 (bedrock:OptimizePrompt grant, flag-gated)
└─▶ 5.3 (runtime env + frontend env)

6.1 (prompt_opt StreamEvent + parser) ─┐
6.2 (usePromptOptimizationStore) ──────┤
                                        ├─▶ 6.3* (PBT Property 4 — per-model fold)
                                        ├─▶ 6.4* (PBT Property 6 — selection→applied)
                                        ├─▶ 6.5* (PBT Property 7 — per-session isolation)
                                        ├─▶ 6.6* (PBT Property 8 — before/after pairing)
                                        ├─▶ 7.1 (useChatEngine case + apply passthrough)
                                        └─▶ 7.2 (PromptOptimizationCard + ui-components)
                                             ├─▶ 7.3* (PBT Property 5 — provenance/attribution)
                                             └─▶ 7.4* (snapshot card)

8.1 (conciergeFlowStore promptOpt + flow-types)
├─▶ 8.2 (ConciergeFlowDiagram node, VITE-gated) ─▶ 8.4* (snapshot node)
└─▶ 8.3* (PBT Property 9 — flow-node fold)

2.3, 5.x ─▶ 10.1* / 10.2* / 10.3* / 10.4* (skipped-by-default smoke/integration)
```

The backend pure seams (1.1 → 2.1 → 2.3) land and are proven before the streaming
handler, then the router/sample runner (3.1 → 3.2), then infrastructure (5.x) and the
frontend (6.x → 7.x, plus the independent flow node 8.x). Edits to
`orchestrator_agent.py` are serialized across waves 3–5 (2.3, 3.1, 3.2) to avoid
write conflicts; every other wave holds only tasks that touch distinct files.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation sub-tasks are never marked optional.
- Each property from the design is its own sub-task, annotated with its property number and the requirement clauses it validates, and placed immediately after the implementation task that creates its seam.
- **Test-first at the pure seams.** All nine properties run fully mocked/pure (no deploy): Hypothesis for Python (`test/python/`), fast-check for TypeScript (`test/typescript/`), ≥ 100 iterations, tagged with the design property text.
- **What is deliberately out of the coding plan.** Live `cdk deploy`/`destroy`, live `OptimizePrompt` behavior, the guardrail, and demo walkthroughs are verification activities. Task 10 authors them as skipped-by-default, env-guarded integration/CDK-assertion tests so they are runnable in a dev/CI account without becoming manual steps.
- **Feature-flag gating.** The whole feature is gated by `features.prompt_optimization` (default off): the router does not accept the `optimize_*` modes, the IAM grant is not added, and the frontend hides the card entry point and flow node (`VITE_PROMPT_OPTIMIZATION_ENABLED`). Because the flag only adds an IAM action and in-process handlers (no new runtime/table/bucket), deploy/destroy remain the standard CDK commands.
- **Validation commands.** Python: `python3 -m py_compile <file>`, `ruff check <paths>`, `./.venv/bin/pytest test/python -q`. CDK: `npx tsc --noEmit -p tsconfig.json`, `npx cdk synth`. Frontend (from `lib/stacks/frontend/app`): `npx tsc -b`, `npx eslint <files>`, `npm run build`, `npx jest test/typescript/<file>`.
- **Constraints carried from steering/design.** Synthetic bank data only (including the Sample_Question); no external endpoints; `OptimizePrompt` receives foundation-model ids only (never an inference-profile id); a variant is applied only through the existing `requested_model`/`system_prompt_override` seams of `_handle_chatbot`; and no Selected_Variant is persisted beyond the applying Presenter's browser session.

```

```
