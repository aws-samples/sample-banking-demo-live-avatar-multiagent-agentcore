# Table of Contents — AWS Product Demo

## Magic Quadrant and Critical Capabilities for AI Application Development Platforms 2026

**Provider:** Amazon Web Services
**Platform:** Amazon Bedrock AgentCore
**Runtime:** 52:30 · 1920×1080 · .mp4 · English · 1x playback
**Scenario:** Trinity Reserve Bank — retail and wealth institution near the Texas Stock Exchange, Dallas
**Capability cutoff:** all capabilities shown are generally available as of 1 August 2026

Timecodes are minutes and seconds from the start of the video.

<!-- INTERNAL — REMOVE THIS BLOCK BEFORE SUBMISSION
Status: PLANNED timings, derived from demo-script.md §3–§4. These are targets, not
measured values. Every timecode below must be re-verified against the final edit
(demo-script.md §5, rehearsal gate 4 / capabilities-mapping.md V21) before this file
is uploaded. Any beat cut during editing must be deleted here, not left pointing at
footage that no longer exists — a TOC entry with no corresponding content is worse
than an omission.

Also confirm before submission:
- V13 — whether Gartner has more than one AWS product under evaluation. If so, this
  file must be split per product, not reused.
- V20 — Policy GA status. Sections 13:25 and 41:25 and differentiator D2 depend on it.
- V2/V3 — the avatar boundary at 46:25 and the language list at 46:55.
-->

---

## 1. Use cases

The Welcome Packet defines three application types. Each is demonstrated end to end.

| Use case                             | Starts      | Runs to | Primary content                                                                                                                                                           |
| ------------------------------------ | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Building AI agents**               | **[14:10]** | [27:55] | Deep research agent — query refinement, research plan, human approval, six-agent parallel execution, synthesis, cited PDF report                                          |
|                                      | **[36:40]** | [46:25] | Customer-facing account opening agent — KYC, eligibility, fraud detection, agent-to-agent collaboration, auditable decline                                                |
| **Building AI assistants**           | **[27:55]** | [36:40] | External customer assistant grounded on the step-1 report — text and images, spoken account progress, automatic quality control, human review, A/B testing, feedback loop |
| **Building multimodal applications** | **[19:35]** | [23:05] | Multimodal input and output in a single agent run — chart reasoning, generated imagery, a chapter as text plus images plus speech                                         |
|                                      | **[46:25]** | [49:55] | Voice experience — multilingual grounded speech-to-speech, tone control, agent-driven visual synchronisation                                                              |

---

## 2. Areas of differentiation

Each is stated at [49:55] and demonstrated earlier at the timecodes given.

| #      | Differentiator                                                                                                                                                                                                                                                         | Stated  | Demonstrated                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| **D1** | **Managed agent loop that exports to open-source code.** An agent declared as configuration and running in minutes, then exported to Strands and extended into a multi-agent topology — no rewrite.                                                                    | [49:55] | **[03:45]**, **[17:00]**                                                     |
| **D2** | **Deterministic policy in front of every tool call, validated by automated reasoning.** The rule authored at [13:25] blocks an adversarial attack at [41:25], at the gateway, before the call leaves.                                                                  | [49:55] | **[13:25]**, **[41:25]**                                                     |
| **D3** | **Identity survives the whole path, including agent to agent.** The research agent acts as the analyst; the customer agent carries the customer's identity across an A2A call to another team's agent. One trace, one identity, two owners.                            | [49:55] | **[12:10]**, **[17:00]**, **[36:40]**                                        |
| **D4** | **Composable and portable out.** Independent capabilities, any framework, any model routed at the gateway, OpenTelemetry export, cloud or on-premises from one artifact, and governance of agents running outside AgentCore.                                           | [49:55] | **[06:30]**, **[09:55]**, **[17:00]**, **[25:30]**                           |
| **D5** | **A closed, fully managed operational loop.** Customer signal to deployed fix across seven stages with no glue code: online evaluation, tracing, IDE fix, evaluation gate, optimization recommendation, A/B with statistical significance, promotion as configuration. | [49:55] | **[23:05]**, **[24:40]**, **[25:30]**, **[27:05]**, **[34:30]**, **[35:40]** |

---

## 3. Critical Capabilities

All twelve Critical Capabilities defined in the Welcome Packet are demonstrated. Primary beat in bold.

| Critical Capability        | Timecodes                              |
| -------------------------- | -------------------------------------- |
| **Grounding**              | **[27:55]**, [39:25], [46:55]          |
| **Guardrails**             | [07:55], [31:30], **[41:25]**, [49:20] |
| **Evaluations**            | **[23:05]**, [31:30], [34:30]          |
| **Observability**          | **[24:40]**, [44:10]                   |
| **Model Catalog**          | **[06:30]**                            |
| **Agentic Framework**      | **[03:45]**, [17:00], [19:00], [36:40] |
| **Multimodal Framework**   | [19:35], **[21:20]**, [30:10], [46:55] |
| **Cost Management**        | [09:55], **[27:05]**, [44:10]          |
| **Agent State Management** | [03:45], **[17:00]**, [19:00]          |
| **Deployment**             | **[25:30]**                            |
| **Orchestration**          | **[09:55]**, [17:00], [25:30], [36:40] |
| **Security**               | [12:10], [13:25], [19:35], **[41:25]** |

### 3.1 Combined capabilities

Six deliberate combinations, each solving a business problem no single capability solves alone.

| Combination               | Capabilities                                             | Timecodes                              |
| ------------------------- | -------------------------------------------------------- | -------------------------------------- |
| Governed research         | Agentic Framework · Orchestration · Security · Grounding | **[09:55]** → [17:00]                  |
| Auditable multi-agent     | Agentic Framework · Security · Observability             | **[36:40]**                            |
| Layered defence           | Guardrails · Security · Grounding                        | **[41:25]**                            |
| Quality as a release gate | Evaluations · Orchestration · Observability              | **[23:05]** → [25:30]                  |
| Closed improvement loop   | Evaluations · Cost Management · Orchestration            | **[34:30]**, [35:40]                   |
| One corpus, four channels | Grounding · Multimodal Framework                         | [27:55], [30:10], [39:25], **[46:55]** |

---

## 4. Topics in sequence

### Open

| Timecode    | Topic                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| **[00:00]** | Scenario — Trinity Reserve Bank, the four applications, synthetic data statement                             |
| **[01:05]** | The AgentCore platform on one slide — capabilities, compliance posture, and the generally-available boundary |

### Section 1 — Deep research agent

| Timecode    | Topic                                                                                                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[01:45]** | Multimodal intake and spec-driven design — the verbatim problem statement, a regulatory PDF and a chart image as design inputs, requirements traceability, governance as code                                                      |
| **[03:45]** | Declaring the agent — AgentCore Harness as configuration-as-code; managed agent loop; retry, stuck detection and failure recovery; least-privilege tool scoping                                                                    |
| **[05:30]** | First working agent and the Agent Inspector                                                                                                                                                                                        |
| **[06:30]** | Model choice and the model catalog — model cards, first- and third-party models, mid-session provider switching, residency-scoped inference                                                                                        |
| **[07:55]** | Guardrails inside the agent loop — a live intervention                                                                                                                                                                             |
| **[08:40]** | Skills — on-demand domain expertise, curated catalog, open specification, progressive disclosure                                                                                                                                   |
| **[09:55]** | Gateway as the AI gateway — MCP and OpenAPI targets, first-party web search with domain and date governance, existing MCP servers, semantic tool selection, token tracking, rate limiting, response caching, dynamic model routing |
| **[12:10]** | Identity — the agent acting as the requesting analyst; token vault; delegated authorization; attribution                                                                                                                           |
| **[13:25]** | Policy — natural-language and Cedar authoring, automated reasoning validation, deterministic enforcement in front of every tool call                                                                                               |
| **[14:10]** | Query refinement and research plan — sub-question decomposition; objectives, methodology, evaluation criteria and expected outcomes; governed search query generation                                                              |
| **[15:30]** | Human in the loop, two ways — pause-and-resume approval and Gateway elicitation, with versioning and attribution                                                                                                                   |
| **[17:00]** | Export to Strands and scale out on Runtime — six section agents in parallel, session isolation, shared filesystem, A2A with agent card discovery, live session introspection                                                       |
| **[19:00]** | Memory — short-term and long-term strategies, cross-session continuity                                                                                                                                                             |
| **[19:35]** | Code Interpreter and Browser — sandboxed execution with network isolation, the agent reasoning over its own generated chart, browser automation with live view, pre-inference PII redaction                                        |
| **[21:20]** | Multimodal output and the final report — generated logo, storefront and service imagery; the recommended-services chapter as text, images and speech; per-claim citations; PDF export                                              |
| **[23:05]** | AgentCore Evaluations — built-in evaluators at session, trace and tool level; custom code-based evaluators; ground truth including expected tool trajectory; user simulation                                                       |
| **[24:40]** | Observability and debugging — span trees with per-span latency, tokens and cost; regression traced to a span and fixed                                                                                                             |
| **[25:30]** | Deployment as infrastructure — CDK, CI/CD with an evaluation quality gate, immutable versions and named endpoints, rollback, Step Functions, **and hybrid deployment on Kubernetes and on-premises**                               |
| **[27:05]** | Optimization and cost — prompt and tool-description recommendations, prompt management, per-component cost attribution including indirect costs                                                                                    |

### Section 2 — External customer AI assistant

| Timecode    | Topic                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[27:55]** | Grounding on the step-1 artifact — managed knowledge base with hybrid search, chunking, ranking and reranking; enterprise connectors; multimodal retrieval returning text and images; citation transparency |
| **[30:10]** | Generated imagery and spoken progress — on-demand service images within brand guardrails; real-time speech narrating account and investment position                                                        |
| **[31:30]** | Automatic quality control — format, length, content filtering and relevance checks on every response; the same evaluator definitions in CI and in production                                                |
| **[33:30]** | Human-in-the-loop review of service descriptions — review queue, content versioning, reviewer attribution, immediate propagation                                                                            |
| **[34:30]** | A/B testing across models — traffic split, multi-metric comparison with statistical significance, promotion by configuration                                                                                |
| **[35:40]** | Continuous feedback loop — customer signal to dataset to batch evaluation to recommendation to A/B to promotion                                                                                             |

### Section 3 — Customer agent, grounding, guardrails, DLP and reporting

| Timecode    | Topic                                                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[36:40]** | The agent opens an account — KYC and sanctions screening, jurisdiction eligibility, product enrollment, fraud detection, A2A collaboration with identity propagation, an auditable decline citing its rule                                         |
| **[39:25]** | Grounding verified rather than asserted — three answers checked against the cited pages of the step-1 PDF side by side, inspectable context assembly, and a correct refusal                                                                        |
| **[41:25]** | Guardrails and data loss prevention under attack — denied topics, content filters, prompt-attack detection, sensitive information filters, entitlement-aware retrieval, employee salary probes blocked at three independent layers, audit evidence |
| **[44:10]** | Out-of-the-box reporting — comprehensiveness, accuracy, response time, cost per conversation, and marketing metrics. Nothing custom-built                                                                                                          |

### Section 4 — Voice experience and the avatar

| Timecode    | Topic                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[46:25]** | The honest boundary — reasoning, grounding, guardrails, voice and visual generation are first-party; photorealistic avatar rendering is a partner layer. Disclosed per Gartner's instruction |
| **[46:55]** | Multilingual grounded voice — speech-to-speech in two languages with native per-language grounding and voice tone control                                                                    |
| **[48:40]** | Agent-driven visual synchronisation — the agent indicates the service under discussion and re-navigates when the customer changes topic, as a traceable tool call                            |
| **[49:20]** | Guardrails on the voice channel — out-of-scope spoken probes blocked by the identical rule set, unified audit log                                                                            |

### Close

| Timecode    | Topic                                                                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[49:55]** | Differentiating capabilities — the five areas in section 2 above                                                                                                                                      |
| **[51:45]** | Deliverables — source for all four applications, container images and Helm charts, and the one-command build plus CI/CD pipeline. Self-serve throughout; no professional services engagement required |

---

## 5. Notes for the reviewer

**Generally available only.** Every capability demonstrated is generally available as of 1 August 2026. No preview or limited-release capability appears in this recording; those are declared separately in the questionnaire response.

**Third-party technology.** One component is not predominantly AWS technology: photorealistic avatar rendering. It is disclosed at [46:25] in thirty seconds and is not demonstrated, per the demonstration guidelines.

**Pre-recorded modules.** Where a step's real latency would exceed roughly twenty seconds, a pre-recorded module is used. Each is identified on screen and aloud, naming the functionality item it covers.

**Data.** All customer, account, market and employee data is synthetic. No production or customer data appears.

**Accompanying material.** Source code for all four applications, container images with Helm charts, and the build and CI/CD definitions are submitted alongside this recording.
