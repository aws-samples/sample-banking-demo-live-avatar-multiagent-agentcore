# Requirements Document

## Introduction

The Trinity Reserve Bank AgentCore demo currently runs its multi-agent interactions **in a single process**. The orchestrator (`patterns/orchestrator-agent/orchestrator_agent.py`) instantiates planner, researcher, synthesizer, and pdf_writer as Strands `Agent` instances with no HTTP between them, and the "six researchers" run as concurrent in-process sub-agents merged in-process. No AgentCore Runtime is configured with the A2A server protocol, no agent card is published at a well-known path, and there is no A2A client. However, the demo narrative (`docs/demo-script.md`, `docs/table-of-contents.md`) already claims a real agent-to-agent (A2A) story: a customer-facing account-opening agent that carries the customer's identity across an A2A call to another team's fraud-research agent — "one trace, one identity, two owners" — with agent card discovery.

This feature implements a real A2A protocol capability so the running demo matches its own narrative. The headline capability is a cross-team A2A hop during account opening / KYC, in which the existing account-opening agent discovers and calls a **new, dedicated fraud-research agent** exposed over A2A, while the requesting customer's verified identity propagates across the hop and the whole path appears in one trace attributed to two agent owners. As a secondary capability (confirmed in scope), the in-process parallel section researchers are also converted to communicate over A2A.

All bank data remains synthetic. The feature must remain self-contained (no external endpoints) and deploy and destroy with standard CDK commands, consistent with the demo guidelines.

## Glossary

- **A2A**: The agent-to-agent protocol in which one agent discovers and invokes another agent over HTTP using a published agent card, as supported by the AgentCore Runtime A2A server protocol and the Strands experimental A2A surface.
- **Agent_Card**: The machine-readable capability descriptor a callee agent publishes (for example at `/.well-known/agent-card.json`) declaring its identity, endpoint, and callable capabilities.
- **Fraud_Research_Agent**: The new, dedicated agent (a new AgentCore Runtime configured with the A2A server protocol) that performs fraud/research analysis for account opening and is the A2A callee. Represents "another team's agent."
- **Account_Opening_Agent**: The existing AI Agent runtime (`ai_agent`) that handles the customer-facing account-opening / KYC flow and acts as the A2A caller.
- **Orchestrator**: The existing in-process orchestrator (`patterns/orchestrator-agent/orchestrator_agent.py`) that runs deep-research sub-agents.
- **Section_Researcher**: One of the parallel research sub-agents currently executed in-process by the Orchestrator via `_run_parallel_research`.
- **Identity_Context**: The verified identity of the requesting end customer (the `user_id` established from the user's JWT, as injected today by `UserScopeHook` in `patterns/utils/tool_guard.py`), together with the acting-agent identity.
- **A2A_Authn_Credential**: The machine-to-machine credential (Cognito M2M OAuth2 access token or signed JWT client assertion) that authenticates the calling agent to the callee agent.
- **Trace**: The end-to-end observability record (spans/segments emitted to the demo's tracing/observability backend) covering a single customer interaction.
- **Flow_Panel**: The frontend flow visualization (for example `ConciergeFlowDiagram.tsx`) that shows the steps of an agent interaction to the demo audience.
- **Cedar_Policy_Engine**: The AgentCore Policy engine (`CfnPolicyEngine`) associated with the Gateway that authorizes tool calls against Cedar policies.
- **Guardrails**: The Bedrock Guardrails (`CfnGuardrail`) applied to model interactions in the demo.

## Requirements

### Requirement 1: Expose the fraud-research agent over the A2A protocol

**User Story:** As the demo presenter, I want a dedicated fraud-research agent exposed over the A2A protocol, so that another team's agent can be discovered and called using a standard agent-to-agent protocol instead of in-process calls.

#### Acceptance Criteria

1. THE Fraud_Research_Agent SHALL be deployed as a dedicated AgentCore Runtime configured with the A2A server protocol.
2. THE Fraud_Research_Agent SHALL serve A2A requests over HTTP at the runtime's configured A2A path.
3. WHEN the Fraud_Research_Agent receives a valid A2A request for a fraud/research analysis of a synthetic account-opening applicant, THE Fraud_Research_Agent SHALL return a fraud/research assessment result.
4. THE Fraud_Research_Agent SHALL operate using synthetic data only.
5. THE Fraud_Research_Agent SHALL be defined in the CDK infrastructure so that it deploys and destroys with standard CDK commands.

### Requirement 2: Publish an agent card for discovery

**User Story:** As a calling agent, I want the fraud-research agent to publish an agent card, so that I can discover its endpoint and capabilities without hardcoded knowledge.

#### Acceptance Criteria

1. THE Fraud_Research_Agent SHALL publish an Agent_Card at a well-known agent card path.
2. THE Agent_Card SHALL declare the Fraud_Research_Agent identity, A2A endpoint, and callable capabilities.
3. WHEN a client requests the Agent_Card at the well-known path, THE Fraud_Research_Agent SHALL return the Agent_Card as a valid machine-readable document.
4. THE Agent_Card SHALL contain the endpoint information required for a caller to construct a subsequent A2A request to the Fraud_Research_Agent.

### Requirement 3: Discover the callee before invoking it

**User Story:** As the account-opening agent, I want to discover the fraud-research agent from its agent card, so that I invoke it based on its declared capabilities rather than static configuration.

#### Acceptance Criteria

1. WHEN the Account_Opening_Agent initiates an A2A collaboration, THE Account_Opening_Agent SHALL retrieve the Fraud_Research_Agent Agent_Card before sending an A2A request.
2. THE Account_Opening_Agent SHALL determine the A2A endpoint of the Fraud_Research_Agent from the retrieved Agent_Card.
3. IF the Agent_Card cannot be retrieved, THEN THE Account_Opening_Agent SHALL report a discovery error, and THE Account_Opening_Agent SHALL NOT proceed with the account-opening decision that depends on the fraud/research result regardless of whether the discovery-error report is successfully produced.

### Requirement 4: Invoke the fraud-research agent over A2A during account opening

**User Story:** As a customer opening an account, I want the account-opening agent to consult the fraud-research agent over A2A during KYC, so that the fraud assessment is produced by a separate team's agent through a real protocol call.

#### Acceptance Criteria

1. WHEN the Account_Opening_Agent reaches the fraud/research step of the account-opening flow, THE Account_Opening_Agent SHALL invoke the Fraud_Research_Agent over the A2A protocol.
2. WHILE an account-opening flow is in progress, THE Account_Opening_Agent SHALL send the synthetic applicant details required for the fraud/research assessment in the A2A request.
3. WHEN the Account_Opening_Agent receives the A2A response from the Fraud_Research_Agent, THE Account_Opening_Agent SHALL incorporate the fraud/research assessment into the account-opening decision.
4. IF any A2A-related error condition occurs, including A2A invocation failure, A2A invocation timeout, network unavailability, or Agent_Card discovery failure, THEN THE Account_Opening_Agent SHALL return an error state for the fraud/research step that identifies the A2A hop as the failing step.
5. IF the Account_Opening_Agent reaches the fraud/research step but the A2A invocation cannot occur due to a system or configuration error, THEN THE Account_Opening_Agent SHALL halt the account-opening process and SHALL return an error.

### Requirement 5: Propagate the customer's verified identity across the A2A hop

**User Story:** As a risk officer, I want the requesting customer's identity to travel with the A2A call, so that the fraud-research agent acts on behalf of that customer and the audit record names one person across two agent owners.

#### Acceptance Criteria

1. WHEN the Account_Opening_Agent invokes the Fraud_Research_Agent over A2A, THE Account_Opening_Agent SHALL include the requesting customer's verified Identity_Context in the A2A request.
2. THE Account_Opening_Agent SHALL derive the customer Identity_Context from the verified user identity established from the user's JWT rather than from model-generated input.
3. WHEN the Fraud_Research_Agent processes an A2A request, THE Fraud_Research_Agent SHALL act using the propagated customer Identity_Context.
4. IF the A2A request does not carry a verified customer Identity_Context, THEN THE Fraud_Research_Agent SHALL reject the request with an authorization error.
5. THE Fraud_Research_Agent SHALL record the propagated customer Identity_Context together with the acting-agent identity for the processed request.

### Requirement 6: Authenticate and authorize the calling agent

**User Story:** As a security reviewer, I want the fraud-research agent to authenticate and authorize the calling agent, so that only permitted agents can invoke it and each agent holds least-privilege access.

#### Acceptance Criteria

1. WHEN the Account_Opening_Agent sends an A2A request to the Fraud_Research_Agent, THE Account_Opening_Agent SHALL present an A2A_Authn_Credential.
2. WHEN the Fraud_Research_Agent receives an A2A request, THE Fraud_Research_Agent SHALL verify the A2A_Authn_Credential before processing the request.
3. IF the A2A_Authn_Credential is missing, invalid, or expired, THEN THE Fraud_Research_Agent SHALL reject the request with an authentication error.
4. IF the authenticated calling agent is not authorized to invoke the requested capability, THEN THE Fraud_Research_Agent SHALL reject the request with an authorization error.
5. THE Fraud_Research_Agent SHALL be granted only the permissions required to perform the fraud/research assessment.

### Requirement 7: Preserve deterministic policy and guardrail controls across the A2A hop

**User Story:** As a risk officer, I want the deterministic tool policy and model guardrails to still apply when work crosses the A2A hop, so that the cross-team call does not bypass existing controls.

#### Acceptance Criteria

1. WHEN the Fraud_Research_Agent calls Gateway tools, THE Cedar_Policy_Engine SHALL authorize each tool call using the propagated customer Identity_Context.
2. WHERE the Fraud_Research_Agent is not permitted to use account-opening or customer-profile write tools, THE Cedar_Policy_Engine SHALL deny those tool calls from the Fraud_Research_Agent even where criterion 7.1 otherwise authorizes tool calls, so that the permission restriction takes precedence over the general authorization.
3. WHEN the Fraud_Research_Agent invokes a model, THE Guardrails SHALL be applied to that model interaction.
4. THE Fraud_Research_Agent SHALL be represented as a distinct calling principal so that policy decisions for the Fraud_Research_Agent are attributable to that agent.
5. IF the Guardrails cannot be applied to a model invocation by the Fraud_Research_Agent, THEN THE Fraud_Research_Agent SHALL block that model invocation entirely.

### Requirement 8: Make the A2A hop auditable in one trace

**User Story:** As an auditor, I want the A2A hop to appear in tracing under a single trace, so that I can follow one customer interaction across two agent owners with one identity.

#### Acceptance Criteria

1. WHEN the Account_Opening_Agent invokes the Fraud_Research_Agent over A2A, THE Trace SHALL include the A2A invocation as a distinct step within the same customer interaction trace.
2. THE Trace SHALL attribute the Account_Opening_Agent step and the Fraud_Research_Agent step to their respective agent owners.
3. THE Trace SHALL associate both the Account_Opening_Agent step and the Fraud_Research_Agent step with the same customer Identity_Context.
4. THE Fraud_Research_Agent SHALL emit its processing spans to the demo's tracing and observability backend.
5. IF the tracing and observability backend fails to capture the A2A step, THEN THE Account_Opening_Agent SHALL block the A2A invocation.

### Requirement 9: Show the A2A call as a distinct step in the flow panel

**User Story:** As the demo presenter, I want the flow panel to visibly show the A2A call as its own step, so that the audience can see the agent-to-agent hop happen during account opening.

#### Acceptance Criteria

1. WHEN the Account_Opening_Agent invokes the Fraud_Research_Agent over A2A, THE Flow_Panel SHALL display the A2A call as a distinct step labeled as an agent-to-agent collaboration.
2. THE Flow_Panel SHALL indicate that the customer Identity_Context is carried across the A2A step.
3. WHEN the A2A step completes, THE Flow_Panel SHALL display the completion state of the A2A step, and the A2A step MAY be considered complete while the Flow_Panel still displays the in-progress state.
4. IF the A2A step fails, THEN THE Flow_Panel SHALL display the failed state of the A2A step.

### Requirement 10: Convert the parallel section researchers to A2A

**User Story:** As the demo presenter, I want the parallel section researchers to communicate over A2A, so that the multi-agent research fan-out demonstrates the A2A protocol rather than only in-process calls.

#### Acceptance Criteria

1. THE Section_Researcher agents SHALL be invoked over the A2A protocol rather than as in-process sub-agents.
2. WHEN the Orchestrator dispatches parallel research work, THE Orchestrator SHALL invoke each Section_Researcher over A2A.
3. WHILE multiple Section_Researcher invocations are in progress, THE Orchestrator SHALL execute the Section_Researcher A2A invocations concurrently.
4. WHEN all dispatched Section_Researcher A2A invocations return, THE Orchestrator SHALL merge the returned research results into a single research result set.
5. IF a Section_Researcher A2A invocation fails, THEN THE Orchestrator SHALL report the failure for that section and SHALL continue merging the results that returned successfully.
6. IF the runtime environment does not support concurrent execution of the Section_Researcher A2A invocations, THEN THE Orchestrator SHALL fail rather than execute the Section_Researcher A2A invocations sequentially.

### Requirement 11: Keep the feature self-contained and deployable

**User Story:** As a demo operator, I want the A2A feature to stay self-contained and deploy and reset cleanly, so that I can run and restart the demo without external dependencies or manual steps.

#### Acceptance Criteria

1. THE Fraud_Research_Agent SHALL communicate only with resources deployed within the demo account and SHALL NOT call external endpoints.
2. THE A2A feature SHALL deploy with the standard CDK deploy command.
3. THE A2A feature SHALL destroy with the standard CDK destroy command.
4. THE A2A feature SHALL use synthetic data only.
5. THE A2A feature SHALL support running for different users in parallel within the same deployment.

### Requirement 12: Scope boundaries

**User Story:** As a reviewer, I want the scope boundaries stated, so that the implementation stays focused on the demonstrated A2A story.

#### Acceptance Criteria

1. THE Account_Opening_Agent SHALL remain the customer-facing caller and SHALL NOT be replaced by a new agent for this feature.
2. WHERE an in-process agent interaction is not the cross-team fraud-research hop or the parallel Section_Researcher fan-out, THE Orchestrator SHALL retain that interaction as an in-process interaction, including where a performance or scalability rationale would otherwise motivate moving that interaction out-of-process.
3. THE A2A feature SHALL NOT introduce agents that call endpoints outside the demo account.
