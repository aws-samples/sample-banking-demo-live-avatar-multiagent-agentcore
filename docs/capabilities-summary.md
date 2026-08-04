# Capabilities Summary

## Gartner MQ / Critical Capabilities — AI Application Development Platforms 2026

What Gartner asked us to demonstrate, and the AWS service that answers each item.
Organised in the four sections of Gartner's brief.

Companion documents: `demo-script.docx` for what appears on screen section by
section, and `capabilities-mapping.docx` for the full requirement-level detail.

---

## 1. Deep research agent

Gartner asks for the whole development lifecycle here, not just a finished agent.

### 1.1 The agent itself

| Gartner asks for                                                                 | AWS service                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Build with an agentic framework                                                  | Strands Agents SDK on Amazon Bedrock AgentCore Runtime                   |
| Take user input, refine and optimise the query with an LLM                       | Claude Sonnet 5 on Amazon Bedrock                                        |
| Break the query into sub-questions                                               | Planner agent, Claude Sonnet 5                                           |
| Research plan naming objectives, methods, evaluation criteria, expected outcomes | Planner agent emitting structured JSON                                   |
| Generate search queries from the refined question                                | Researcher agent, Claude Sonnet 5                                        |
| Human in the loop to review and refine the plan                                  | Two-phase plan/approve flow; AgentCore Gateway elicitation               |
| Tool calling / MCP, such as web search APIs                                      | AgentCore Gateway (MCP), Amazon Nova Web Grounding, AgentCore Web Search |
| Divide research into sections; multi-agent collaboration for parallel processing | AgentCore Runtime, multi-agent supervisor pattern                        |
| Human in the loop to refine content                                              | AgentCore Gateway elicitation                                            |
| Multimodal input, e.g. data-analysis charts                                      | Claude vision on Bedrock; AgentCore Code Interpreter                     |
| Multimodal output — graphics, logos, storefronts                                 | Amazon Nova Canvas (images), Amazon Nova Reel (video)                    |
| One chapter as text, images and speech                                           | Nova Canvas, Amazon Nova Sonic 2                                         |
| Combine sections with introduction and conclusion                                | Synthesizer agent, Claude Sonnet 5                                       |
| Citations for all sources                                                        | Nova Web Grounding citations carried through to the report               |
| Export as PDF                                                                    | Lambda PDF generator, Amazon S3                                          |

### 1.2 The lifecycle around it

| Gartner asks for       | AWS service                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| IDE-based development  | Kiro — specs (requirements, design, tasks) and steering files                                |
| Low-code development   | Amazon Bedrock AgentCore Harness — the agent as configuration                                |
| High-code development  | Strands Agents SDK; export from harness to code                                              |
| Graphical development  | AgentCore console; AWS Step Functions visual builder                                         |
| Model catalog          | Amazon Bedrock model catalog and cross-Region inference profiles                             |
| Testing and validation | Kiro-generated tests; AgentCore Evaluations                                                  |
| Data preparation       | Amazon Bedrock Data Automation; Managed Knowledge Base ingestion                             |
| Tracing                | AgentCore Observability; AWS X-Ray                                                           |
| Evaluation             | AgentCore Evaluations — online, batch, user simulation                                       |
| Debugging              | AgentCore Observability span trees; Agent Inspector                                          |
| Agent operations       | Amazon CloudWatch dashboards; AgentCore Observability                                        |
| Orchestration          | AgentCore Runtime; AgentCore Gateway; AWS Step Functions                                     |
| Cost management        | CloudWatch cost attribution; AWS Budgets; resource tagging                                   |
| Control processes      | AgentCore Policy (Cedar); Amazon Bedrock Guardrails; Kiro steering; evaluation release gates |
| Deployment             | AWS CDK; AgentCore CLI; Amazon ECR; AWS CodeBuild; Amazon EKS and Helm for hybrid            |

---

## 2. External customer AI assistant

| Gartner asks for                                                   | AWS service                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Assistant grounded on the section 1 output                         | Amazon Bedrock Managed Knowledge Base over the generated PDF and imagery             |
| Detailed service information as text and images                    | Managed Knowledge Base multimodal retrieval; Bedrock Data Automation                 |
| Generate service images                                            | Amazon Nova Canvas                                                                   |
| Speak account and investment progress                              | Amazon Nova Sonic 2 speech-to-speech                                                 |
| Automatic quality control — format, length, filtering, irrelevance | Response schema validation; Bedrock Guardrails; AgentCore Evaluations online scoring |
| Human review to update service descriptions                        | AgentCore Gateway elicitation; versioned content in Amazon S3                        |
| A/B test output across models                                      | AgentCore Optimization — configuration bundles and gateway traffic split             |
| Continuous feedback loop                                           | AgentCore Observability, Evaluations, Optimization recommendations                   |

---

## 3. Customer agent — grounding, guardrails, DLP, reporting

| Gartner asks for                                                                             | AWS service                                                                                             |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Open an account                                                                              | AgentCore Runtime with AgentCore Gateway tools on AWS Lambda                                            |
| Validate the bank can do business with the customer                                          | Eligibility and sanctions tools as Gateway targets                                                      |
| Let customers take up services                                                               | Gateway tools writing to Amazon DynamoDB                                                                |
| Detect fraudulent accounts and transactions                                                  | Second agent via agent-to-agent call; AgentCore Identity on-behalf-of delegation                        |
| Grounding by context and prompt engineering                                                  | Structured context assembly in the agent, with per-element token budget                                 |
| Grounding by RAG                                                                             | Amazon Bedrock Managed Knowledge Base on Amazon S3 Vectors                                              |
| Quickly verify answers are grounded in the section 1 document                                | Citations with source and page, checked against the PDF on screen                                       |
| Guardrails block requests unrelated to the bank                                              | Amazon Bedrock Guardrails — denied topics                                                               |
| Employee-salary questions trigger guardrails                                                 | Bedrock Guardrails; entitlement-aware retrieval by identity                                             |
| Data loss prevention                                                                         | Bedrock Guardrails sensitive-information filters; prompt-attack detection; AgentCore Policy tool denial |
| Out-of-the-box reports — comprehensiveness, accuracy, response time, cost, marketing metrics | AgentCore Observability and Evaluations dashboards; Amazon CloudWatch                                   |

---

## 4. Voice experience and the avatar

| Gartner asks for                                     | AWS service                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| Photorealistic avatar                                | Partner rendering layer on the AWS voice stream — disclosed, not demonstrated |
| At least two languages                               | Amazon Nova Sonic 2, native multilingual                                      |
| Guidance in multiple languages and voice tones       | Nova Sonic 2 voice and prosody selection                                      |
| Ground the avatar to the section 2 text and images   | The same Bedrock Managed Knowledge Base as section 2                          |
| Spoken question and answer on why to choose the bank | Nova Sonic 2 with AgentCore Gateway tools                                     |
| Show or indicate the item being discussed            | Agent-emitted UI tool call through AgentCore Gateway                          |
| Change item when the customer asks                   | Same UI tool, re-invoked mid-conversation                                     |
| Test guardrails with out-of-scope questions          | Amazon Bedrock Guardrails, the same rule set as the text channels             |

---

## 5. Services used to build the solution

### Agent platform

| Service                                   | Role                                                              |
| ----------------------------------------- | ----------------------------------------------------------------- |
| Amazon Bedrock AgentCore Runtime          | Hosts the agents; session isolation, streaming, long-running jobs |
| Amazon Bedrock AgentCore Gateway          | Publishes every tool as MCP; web search; elicitation              |
| Amazon Bedrock AgentCore Memory           | Preferences, session summaries, recall across runs                |
| Amazon Bedrock AgentCore Identity         | Agents act as the signed-in user; on-behalf-of delegation         |
| Amazon Bedrock AgentCore Policy           | Deterministic allow and deny ahead of the model (Cedar)           |
| Amazon Bedrock AgentCore Observability    | Traces, spans, latency, token and cost attribution                |
| Amazon Bedrock AgentCore Evaluations      | Quality gates; online and batch scoring                           |
| Amazon Bedrock AgentCore Optimization     | Prompt recommendations, configuration bundles, A/B tests          |
| Amazon Bedrock AgentCore Browser          | Sources with no API, with human takeover                          |
| Amazon Bedrock AgentCore Code Interpreter | Sandboxed analysis and chart generation                           |
| Amazon Bedrock AgentCore Harness          | The agent declared as configuration                               |

### Models

| Service                                                  | Role                                                   |
| -------------------------------------------------------- | ------------------------------------------------------ |
| Claude Sonnet 5, Opus 5, Opus 4.7, Sonnet 4.6, Haiku 4.5 | Reasoning, planning, synthesis; selectable per session |
| Amazon Nova Sonic 2                                      | Real-time speech-to-speech                             |
| Amazon Nova 2 Lite                                       | Low-cost tool selection and web grounding              |
| Amazon Nova Canvas                                       | Image generation and editing                           |
| Amazon Nova Reel                                         | Video generation                                       |
| Amazon Nova 2 Multimodal Embeddings                      | Knowledge base embeddings                              |

### Data and knowledge

| Service                               | Role                                              |
| ------------------------------------- | ------------------------------------------------- |
| Amazon Bedrock Managed Knowledge Base | Managed RAG pipeline with native connectors       |
| Amazon S3 Vectors                     | Vector store for the knowledge base               |
| Amazon Bedrock Data Automation        | Parses documents and imagery for ingestion        |
| Amazon Bedrock Guardrails             | Content, topic and sensitive-information policy   |
| Amazon S3                             | Documents, generated PDFs, images, website assets |
| Amazon DynamoDB                       | Application records and session metadata          |

### Build and delivery

| Service                                                  | Role                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| Kiro                                                     | Spec-driven design, steering as governance-as-code, generated tests |
| AWS CDK (TypeScript)                                     | All infrastructure as code                                          |
| AgentCore CLI                                            | Scaffold, run locally, deploy, invoke                               |
| AWS CloudFormation                                       | Deployment engine behind CDK                                        |
| Amazon ECR, AWS CodeBuild                                | Container images for the agent runtimes                             |
| Amazon ECS on AWS Fargate                                | The real-time voice worker (ARM64)                                  |
| AWS Lambda                                               | Gateway tool implementations                                        |
| Amazon API Gateway                                       | Token and feedback endpoints                                        |
| Amazon Cognito                                           | Authentication and per-user identity                                |
| AWS Secrets Manager, AWS Systems Manager Parameter Store | Credentials and runtime configuration                               |
| Amazon CloudWatch, AWS X-Ray                             | Logs, metrics, dashboards, tracing                                  |
| AWS WAF, AWS KMS                                         | Edge protection and encryption                                      |
| Amazon CloudFront, Amazon S3                             | Frontend hosting                                                    |

### Third-party components, disclosed

| Component                | Licence    | Role                                                      |
| ------------------------ | ---------- | --------------------------------------------------------- |
| LiveKit Cloud            | Commercial | WebRTC transport for the real-time voice channel          |
| Strands Agents SDK       | Apache-2.0 | Agent framework for the code-level implementation         |
| TalkingHead, HeadAudio   | MIT        | Browser avatar rendering and audio-to-viseme lip sync     |
| Avatar rendering partner | Commercial | Photorealistic avatar layer — disclosed, not demonstrated |

---

## 6. Declared exceptions

Stated plainly because Gartner does not evaluate capabilities that are not
generally available, and the source code is a deliverable.

| Item                            | Position                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AgentCore Payments              | Public preview. Not demonstrated, declared as beta.                                                                                                          |
| AgentCore Failure Insights      | Public preview. Not demonstrated. Recommendations, batch evaluation and A/B testing are GA and are shown.                                                    |
| AWS Agent Registry              | Generally available 6 August 2026. Gateway connectors, the AWS-curated skills catalog and AWS Marketplace cover the catalog requirement.                     |
| Photorealistic avatar rendering | Partner technology. AWS supplies speech, grounding, tool calls and guardrails; the rendering layer is disclosed and the partner product is not demonstrated. |
| Terraform for AgentCore CLI     | Not yet available. AWS CDK is used and claimed.                                                                                                              |
| Claude Agent SDK harness export | Not yet available. Strands export is used and claimed.                                                                                                       |
