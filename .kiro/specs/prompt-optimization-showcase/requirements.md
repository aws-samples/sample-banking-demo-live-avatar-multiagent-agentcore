# Requirements Document

## Introduction

The Trinity Reserve Bank AgentCore demo runs a customer-facing **AI Agent** (the "AI Client Advisor") through the orchestrator's `mode="chatbot"` path in `patterns/orchestrator-agent/orchestrator_agent.py` (`_handle_chatbot`). Today that agent runs on a fixed system prompt (`CHATBOT_PROMPT`) and a fixed default model (`us.anthropic.claude-sonnet-4-6`, an inference profile), with per-request seams already in place: `_handle_chatbot` accepts `requested_model` (frontend `model_id`) and `system_prompt_override`.

This feature visually showcases **Amazon Bedrock Prompt Optimization** applied live to the AI Agent. A demo presenter triggers an optimization workflow that takes the AI Agent's current system prompt and, for each of a small set of supported target foundation models, streams the Bedrock `OptimizePrompt` events (analysis, then the model-tailored optimized prompt) into a visible UI. The presenter (human-in-the-loop) reviews the analysis and optimized prompt for each target model side-by-side with the original, optionally runs one representative sample question through the current configuration and a chosen candidate configuration to compare answers, and then applies a chosen `(model, prompt)` pairing to the live AI Agent for the rest of the session using the existing `requested_model` and `system_prompt_override` seams.

Key verified technical constraints shape these requirements:

- The Bedrock `OptimizePrompt` streaming API (boto3 `bedrock-agent-runtime`: `optimize_prompt(input={"textPrompt": {"text": <prompt>}}, targetModelId=<foundation-model-id>)`) streams an `analyzePromptEvent` (analysis) followed by an `optimizedPromptEvent` (the rewritten, model-tailored prompt). It returns analysis and an optimized prompt only — it does **not** return evaluation scores, latency, or cost.
- The optimized prompt is produced **per target model**; it is tailored to that model and is not one model-agnostic prompt. The meaningful comparisons are therefore the **baseline** (current model + current prompt) versus a **candidate** (a target model + the prompt optimized for that same target model). Any other pairing shown must be labeled with its provenance.
- `OptimizePrompt` accepts **foundation-model IDs only**, not inference-profile IDs. The AI Agent's current runtime model (`us.anthropic.claude-sonnet-4-6`) is an inference profile and is therefore **not** a valid optimize target; the current prompt is optimized toward supported foundation models instead.
- The verified-supported target foundation models (confirmed working in the target account, `us-east-1`) are exactly: `anthropic.claude-sonnet-4-5-20250929-v1:0` (Claude Sonnet 4.5), `anthropic.claude-haiku-4-5-20251001-v1:0` (Claude Haiku 4.5), and `anthropic.claude-3-haiku-20240307-v1:0` (Claude 3 Haiku). The feature uses at most these three.
- Any scoring or comparison presented to the audience must come from the feature's own before/after sample generation or from clearly-labeled heuristics; it must never be presented as scores returned by Bedrock.

The feature is gated behind a feature flag (consistent with `lib/common/feature-flags.ts` + `cdk.json`) and requires the shared AgentCore execution role (`lib/stacks/backend/agentcore-role.ts`) to grant the `bedrock:OptimizePrompt` action. Consistent with the repo steering (`docs/guidelines.md`), the feature is self-contained (no external endpoints), uses synthetic bank data only, and deploys and destroys with standard CDK commands.

## Glossary

- **AI_Agent**: The customer-facing AI Client Advisor — the orchestrator path `mode="chatbot"` handled by `_handle_chatbot` in `patterns/orchestrator-agent/orchestrator_agent.py`. The subject of the optimization showcase.
- **Current_System_Prompt**: The system prompt the AI_Agent uses by default (`CHATBOT_PROMPT`) when no `system_prompt_override` is supplied.
- **Current_Model**: The model the AI_Agent runs on by default (`us.anthropic.claude-sonnet-4-6`), an inference profile that is not a valid optimize target.
- **Optimize_Service**: The backend capability that calls the Bedrock `OptimizePrompt` streaming API via the boto3 `bedrock-agent-runtime` client and relays its streamed events.
- **Target_Model**: A foundation model, identified by a foundation-model ID, for which the Current_System_Prompt is optimized. Restricted to the Supported_Target_Models.
- **Supported_Target_Models**: The fixed set of at most three verified foundation models: `anthropic.claude-sonnet-4-5-20250929-v1:0`, `anthropic.claude-haiku-4-5-20251001-v1:0`, and `anthropic.claude-3-haiku-20240307-v1:0`.
- **Inference_Profile_ID**: A model identifier of the inference-profile form (for example, one prefixed `us.anthropic.`) that `OptimizePrompt` rejects as a target.
- **Analysis_Message**: The content streamed by the Bedrock `analyzePromptEvent` describing how the prompt is analyzed for a Target_Model.
- **Optimized_Prompt**: The rewritten, model-tailored system prompt streamed by the Bedrock `optimizedPromptEvent` for a specific Target_Model.
- **Variant**: A `(model, prompt)` pairing that can be shown and selected. The Baseline_Variant is (Current_Model + Current_System_Prompt); a Candidate_Variant is (a Target_Model + the Optimized_Prompt produced for that same Target_Model).
- **Baseline_Variant**: The Variant consisting of the Current_Model and the Current_System_Prompt.
- **Candidate_Variant**: A Variant consisting of a Target_Model and the Optimized_Prompt produced for that same Target_Model.
- **Provenance_Label**: A visible label on a Variant stating which prompt was optimized for which model, and whether the Variant is the Baseline_Variant.
- **Selected_Variant**: The Variant the Presenter chooses to apply to the live AI_Agent session.
- **Before_After_Comparison**: The optional step that runs one representative sample question through the Baseline_Variant and the Selected_Variant (or a chosen Candidate_Variant) and displays both generated answers side-by-side.
- **Sample_Question**: A representative synthetic user question used for the Before_After_Comparison.
- **Presenter**: The human demo operator who triggers the workflow, reviews variants, and selects the Variant to apply (the human-in-the-loop).
- **Optimization_Showcase**: The end-to-end feature: trigger, per-model streaming, comparison, selection, optional before/after, and application to the live AI_Agent.
- **Flow_Panel**: The frontend flow visualization (for example `components/concierge-flow/` or `components/flow/`) that shows steps of an agent interaction to the demo audience.
- **Stream_Event**: A typed event on the orchestrator's SSE stream, defined in the frontend `StreamEvent` union (`lib/stacks/frontend/app/src/lib/agentcore-client/types.ts`) and parsed in `parsers/strands.ts`.
- **Showcase_Card**: The generative-UI chat component (registered in `components/chat/ui-components.ts`) that renders the Optimization_Showcase, analogous to existing cards such as `ServicesCatalogCard`.
- **AgentCore_Role**: The shared AgentCore execution role built in `lib/stacks/backend/agentcore-role.ts`.
- **Feature_Flag**: The flag in `lib/common/feature-flags.ts` (with its `cdk.json` context entry) that gates this feature.
- **Session**: A single user's AI_Agent conversation session, identified by `session_id`, that can run in parallel with other users' sessions.

## Requirements

### Requirement 1: Trigger the optimization workflow for the AI Agent's current prompt

**User Story:** As a Presenter, I want to trigger a prompt-optimization workflow for the AI Agent's current system prompt against the supported target models, so that the audience sees Bedrock Prompt Optimization run live on the AI Agent.

#### Acceptance Criteria

1. WHEN the Presenter triggers the Optimization_Showcase, THE Optimize_Service SHALL use the Current_System_Prompt as the prompt text submitted for optimization.
2. WHEN the Presenter triggers the Optimization_Showcase, THE Optimize_Service SHALL request optimization for each model in the Supported_Target_Models.
3. THE Optimize_Service SHALL submit at most three Target_Model optimization requests per triggered Optimization_Showcase.
4. WHEN the Optimize_Service submits an optimization request for a Target_Model, THE Optimize_Service SHALL call the Bedrock `OptimizePrompt` streaming API with the Current_System_Prompt text and that Target_Model foundation-model ID.
5. WHERE the Feature_Flag is disabled, THE Optimization_Showcase SHALL NOT be triggerable and THE AI_Agent SHALL operate as it does without this feature.

### Requirement 2: Restrict optimization targets to supported foundation models

**User Story:** As a security and correctness reviewer, I want optimization targets restricted to verified foundation-model IDs, so that invalid targets and inference-profile IDs are never submitted to Bedrock.

#### Acceptance Criteria

1. THE Optimize_Service SHALL submit optimization requests only for models in the Supported_Target_Models.
2. IF a requested Target_Model identifier is an Inference_Profile_ID, THEN THE Optimize_Service SHALL exclude that identifier from submission and SHALL surface an invalid-target state for that identifier.
3. THE Optimize_Service SHALL submit each Target_Model to the Bedrock `OptimizePrompt` API using its foundation-model ID.
4. THE Optimize_Service SHALL NOT submit the Current_Model inference profile as a Target_Model.

### Requirement 3: Stream analysis and optimized prompt visibly per target model

**User Story:** As an audience member, I want to see the analysis and then the optimized prompt stream in for each target model, so that the optimization workflow is visible as it happens.

#### Acceptance Criteria

1. WHEN the Bedrock `OptimizePrompt` API returns an `analyzePromptEvent` for a Target_Model, THE Optimize_Service SHALL emit a Stream_Event carrying the Analysis_Message and the associated Target_Model identifier.
2. WHEN the Bedrock `OptimizePrompt` API returns an `optimizedPromptEvent` for a Target_Model, THE Optimize_Service SHALL emit a Stream_Event carrying the Optimized_Prompt and the associated Target_Model identifier.
3. WHEN the Showcase_Card receives a Stream_Event carrying an Analysis_Message, THE Showcase_Card SHALL display the Analysis_Message under the associated Target_Model.
4. WHEN the Showcase_Card receives a Stream_Event carrying an Optimized_Prompt, THE Showcase_Card SHALL display the Optimized_Prompt under the associated Target_Model.
5. WHILE optimization requests are in progress, THE Showcase_Card SHALL display an in-progress state for each Target_Model that has not yet produced an Optimized_Prompt.

### Requirement 4: Compare variants side-by-side with the original

**User Story:** As a Presenter, I want each target model's analysis and optimized prompt shown side-by-side with the original prompt, so that I can compare the variants before choosing one.

#### Acceptance Criteria

1. THE Showcase_Card SHALL display the Current_System_Prompt as the Baseline_Variant prompt.
2. FOR each Target_Model that produced an Optimized_Prompt, THE Showcase_Card SHALL display the Optimized_Prompt alongside the Current_System_Prompt.
3. THE Showcase_Card SHALL display each displayed Variant with a Provenance_Label.
4. THE Provenance_Label for the Baseline_Variant SHALL identify the Baseline_Variant as the current configuration.
5. THE Provenance_Label for a Candidate_Variant SHALL identify which Target_Model the displayed Optimized_Prompt was optimized for.
6. WHERE the Showcase_Card offers a Variant that pairs a prompt with a model other than the model the prompt was optimized for, THE Showcase_Card SHALL display a Provenance_Label that states the mismatch between the prompt's optimized-for model and the paired model.

### Requirement 5: Present scoring and comparison with correct attribution

**User Story:** As a Presenter, I want any scores or comparison indicators clearly attributed, so that the audience is never misled into thinking Bedrock returned evaluation scores.

#### Acceptance Criteria

1. THE Showcase_Card SHALL NOT present any evaluation score, latency figure, or cost figure as a value returned by the Bedrock `OptimizePrompt` API.
2. WHERE the Showcase_Card displays a comparison indicator that is not produced by the Before_After_Comparison, THE Showcase_Card SHALL label that indicator as a heuristic.
3. WHERE the Showcase_Card displays a comparison result produced by the Before_After_Comparison, THE Showcase_Card SHALL attribute that result to the feature's own sample generation.

### Requirement 6: Human-in-the-loop selection of a variant

**User Story:** As a Presenter, I want to choose which variant to apply to the live AI Agent, so that a human decides the configuration rather than it being applied automatically.

#### Acceptance Criteria

1. THE Showcase_Card SHALL present the Baseline_Variant and each available Candidate_Variant as selectable options.
2. THE Optimization_Showcase SHALL NOT apply any Variant to the AI_Agent Session until the Presenter selects a Variant.
3. WHEN the Presenter selects a Variant, THE Optimization_Showcase SHALL record that Variant as the Selected_Variant.
4. WHEN the Presenter selects the Baseline_Variant, THE Optimization_Showcase SHALL retain the Current_Model and the Current_System_Prompt for the Session.

### Requirement 7: Optional before/after sample comparison

**User Story:** As a Presenter, I want to run one sample question through the current configuration and a chosen configuration, so that the audience sees a real before/after difference in the AI Agent's answers.

#### Acceptance Criteria

1. WHERE the Presenter requests a Before_After_Comparison, THE Optimization_Showcase SHALL run the Sample_Question through the Baseline_Variant and produce a generated answer.
2. WHERE the Presenter requests a Before_After_Comparison, THE Optimization_Showcase SHALL run the Sample_Question through the chosen Candidate_Variant and produce a generated answer.
3. WHEN both Before_After_Comparison answers are produced, THE Showcase_Card SHALL display the Baseline_Variant answer and the chosen Candidate_Variant answer side-by-side.
4. THE Before_After_Comparison SHALL generate each displayed answer from a live model invocation rather than from a stored or fabricated answer.
5. THE Before_After_Comparison SHALL label each displayed answer with the Provenance_Label of the Variant that produced it.
6. IF a Before_After_Comparison answer generation fails for one Variant, THEN THE Showcase_Card SHALL display a failure state for that Variant answer and SHALL display the answer for the other Variant if that generation succeeded.

### Requirement 8: Apply the selected variant to the live AI Agent session

**User Story:** As a Presenter, I want the selected variant applied to the live AI Agent for the session, so that subsequent conversation uses the chosen model and prompt.

#### Acceptance Criteria

1. WHEN the Presenter applies a Candidate_Variant, THE AI_Agent SHALL use that Candidate_Variant's Target_Model as the `requested_model` for subsequent requests in the Session.
2. WHEN the Presenter applies a Candidate_Variant, THE AI_Agent SHALL use that Candidate_Variant's Optimized_Prompt as the `system_prompt_override` for subsequent requests in the Session.
3. WHEN the Presenter applies the Baseline_Variant, THE AI_Agent SHALL use the Current_Model and SHALL NOT set a `system_prompt_override` for subsequent requests in the Session.
4. THE application of a Selected_Variant SHALL affect only the applying Presenter's Session and SHALL NOT change the configuration of other users' Sessions.
5. WHEN a Selected_Variant has been applied, THE Optimization_Showcase SHALL display which Variant is currently applied to the Session.

### Requirement 9: Make the optimization a distinct, visible step in the flow

**User Story:** As a Presenter, I want the optimization workflow shown as its own step in the flow panel, so that the audience can clearly see the showcase as a discrete stage of the demo.

#### Acceptance Criteria

1. WHEN the Optimization_Showcase is triggered, THE Flow_Panel SHALL display the Optimization_Showcase as a distinct step labeled as a prompt-optimization step.
2. WHILE optimization requests are in progress, THE Flow_Panel SHALL display an in-progress state for the Optimization_Showcase step.
3. WHEN the Presenter applies a Selected_Variant, THE Flow_Panel SHALL display a completion state for the Optimization_Showcase step.
4. IF the Optimization_Showcase step fails for all Target_Models, THEN THE Flow_Panel SHALL display a failed state for the Optimization_Showcase step.

### Requirement 10: Resilient per-model error handling

**User Story:** As a Presenter, I want a failure for one target model to not abort the others, so that the showcase still proceeds with the models that succeed.

#### Acceptance Criteria

1. IF the Bedrock `OptimizePrompt` request for one Target_Model fails, THEN THE Optimize_Service SHALL continue processing the optimization requests for the other Target_Models.
2. IF the Bedrock `OptimizePrompt` request for one Target_Model fails, THEN THE Showcase_Card SHALL display a failure state for that Target_Model.
3. IF a Target_Model is rejected as an invalid target by the Bedrock `OptimizePrompt` API, THEN THE Showcase_Card SHALL display an invalid-target state for that Target_Model.
4. WHEN at least one Target_Model produces an Optimized_Prompt, THE Showcase_Card SHALL present the successful Candidate_Variants for selection regardless of failures for other Target_Models.
5. WHILE any Target_Model optimization request is unresolved, THE Showcase_Card SHALL distinguish the unresolved Target_Models from the Target_Models that have succeeded or failed.

### Requirement 11: Least-privilege IAM for optimization

**User Story:** As a security reviewer, I want the optimization capability granted with least privilege, so that the demo only holds the permission it needs.

#### Acceptance Criteria

1. THE AgentCore_Role SHALL be granted the `bedrock:OptimizePrompt` action.
2. THE Optimize_Service SHALL invoke the Bedrock `OptimizePrompt` API using the AgentCore_Role.
3. THE grant of the `bedrock:OptimizePrompt` action SHALL be defined in the CDK infrastructure so that it deploys and destroys with standard CDK commands.

### Requirement 12: Feature-flag gating and self-contained deployment

**User Story:** As a demo operator, I want the showcase gated by a feature flag and self-contained, so that I can enable or disable it and deploy and reset the demo without external dependencies.

#### Acceptance Criteria

1. THE Optimization_Showcase SHALL be gated by a Feature_Flag defined in `lib/common/feature-flags.ts` with a corresponding `cdk.json` context entry.
2. WHERE the Feature_Flag is disabled, THE demo SHALL deploy and operate without the Optimization_Showcase resources or UI affordances.
3. THE Optimization_Showcase SHALL communicate only with resources within the demo account and SHALL NOT call external endpoints.
4. THE Optimization_Showcase SHALL use synthetic bank data only, including for the Sample_Question.
5. THE Optimization_Showcase SHALL deploy with the standard CDK deploy command and SHALL destroy with the standard CDK destroy command.
6. THE Optimization_Showcase SHALL support running for different users in parallel within the same deployment.

### Requirement 13: Scope boundaries

**User Story:** As a reviewer, I want the scope boundaries stated, so that the implementation stays focused on showcasing prompt optimization for the AI Agent.

#### Acceptance Criteria

1. THE Optimization_Showcase SHALL optimize only the Current_System_Prompt of the AI_Agent and SHALL NOT optimize prompts of other agent phases (planner, researcher, synthesizer, evaluation, menu).
2. THE Optimization_Showcase SHALL apply a Selected_Variant only through the existing `requested_model` and `system_prompt_override` seams of `_handle_chatbot` and SHALL NOT introduce a separate model-invocation path for the AI_Agent.
3. THE Optimization_Showcase SHALL NOT persist a Selected_Variant beyond the applying Presenter's Session.
