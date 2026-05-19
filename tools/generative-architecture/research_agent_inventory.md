# Research Agent — Architecture Inventory

Source repo: `gartner-app-dev-research-agent` (read-only audit for diagram regeneration).
Stage audited: **dev** (context resolved from `cdk.json` → `accounts.dev.id = 710562346591`, `region = us-east-1`).
Stack name base: **`gartner-appdev-2026`**.

This document enumerates every component a regenerated architecture diagram must render. All file references are relative to the research-agent repo root.

---

## 1. Feature flags (dev stage defaults)

Defaults live in `lib/common/feature-flags.ts` (the `DEFAULT_FEATURES` const). `cdk.json → context.features` overrides; any keys not listed below fall back to the TypeScript defaults. The effective dev values below are the merge of `DEFAULT_FEATURES` and `cdk.json`.

| flag_name                | default (effective dev) | source_file:line                 | controls_which_resource                                                                                                                                                                                                                                               |
| ------------------------ | ----------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `avatar`                 | `true`                  | `lib/common/feature-flags.ts:31` | Backend → `Runtime_avatar` (`CfnRuntime`) + `AvatarImage` `DockerImageAsset`; frontend wires `VITE_RUNTIME_ARN_AVATAR` only when `true`                                                                                                                               |
| `knowledge_base`         | `true`                  | `lib/common/feature-flags.ts:32` | Shared → `KbRole`, `KbSupplementalBucket`, `KbVectorBucket`, `KbVectorIndex`, `IamWaiterFunction`, `KnowledgeBase` (`CfnKnowledgeBase`), `KbDataSource`, `KbIngestFunction` + reportsBucket S3 event notifications; Backend → `KbResetLambda` + `/kb-reset` API route |
| `kb_backend`             | `"s3-vectors"`          | `lib/common/feature-flags.ts:33` | Switches Shared KB storage path — only the `s3-vectors` branch is implemented (builds `CfnVectorBucket` + `CfnIndex`)                                                                                                                                                 |
| `neptune`                | `false`                 | `lib/common/feature-flags.ts:34` | Shared → `NeptuneGraph` (`CfnGraph`) + Neptune SSM params (not provisioned in dev)                                                                                                                                                                                    |
| `episodic_memory`        | `true`                  | `lib/common/feature-flags.ts:35` | Adds `EpisodicMemoryStrategy` entry to `AgentMemory` (`AWS::BedrockAgentCore::Memory`)                                                                                                                                                                                |
| `semantic_memory`        | `true`                  | `lib/common/feature-flags.ts:36` | Adds `SemanticMemoryStrategy` entry to `AgentMemory`                                                                                                                                                                                                                  |
| `user_preference_memory` | `true`                  | `lib/common/feature-flags.ts:37` | Adds `UserPreferenceMemoryStrategy` entry to `AgentMemory`                                                                                                                                                                                                            |
| `durable_functions`      | `false`                 | `lib/common/feature-flags.ts:38` | Backend → `Tool_research_orchestrator` Lambda + its log group (OFF in dev)                                                                                                                                                                                            |
| `guardrails`             | `true`                  | `lib/common/feature-flags.ts:39` | Backend → `Guardrail` (`CfnGuardrail`) + guardrail SSM params                                                                                                                                                                                                         |
| `browser`                | `true`                  | `lib/common/feature-flags.ts:40` | Orchestrator runtime imports `BROWSER_TOOLS` (AgentCore Browser microVM is invoked at runtime via `bedrock-agentcore` APIs granted on `AgentCoreRole`). No standalone CDK resource — the flag toggles in-container behavior.                                          |

Model IDs (`DEFAULT_MODELS`, lines 46–51) — see section 6.

---

## 2. CDK constructs by stack

Only infrastructure constructs. `StringParameter`, `CfnOutput`, and `NagSuppressions` are intentionally omitted unless they are the only representation of a resource. Line numbers are approximate (derived from the read-tool outputs).

### 2.1 Frontend stack — `lib/stacks/frontend/index.ts`

- `LoggingBucket` — custom construct wrapping `Bucket` — `lib/stacks/frontend/index.ts:29`
- `WebsiteBucket` — `Bucket` — `lib/stacks/frontend/index.ts:31`
- `CloudfrontWebAcl` — `@aws/pdk/static-website`'s `CloudfrontWebAcl` (global WAF with Common/IpReputation/BotControl managed rule sets) — `lib/stacks/frontend/index.ts:35`
- `Distribution` — `aws-cloudfront.Distribution` (TLS 1.2+, S3 OAC origin, SPA 404/403 → `/index.html`, WAF-attached, logs to `LoggingBucket`) — `lib/stacks/frontend/index.ts:54`

### 2.2 FrontendDeployment stack — `lib/stacks/frontend/index.ts`

- `StaticWebsiteBuild` — `@cdklabs/deploy-time-build.NodejsBuild` (runs `npm install && npm run build` on CodeBuild, uploads `dist/` to `WebsiteBucket`, invalidates `Distribution`, receives Vite env vars built in `lib/stage.ts`) — `lib/stacks/frontend/index.ts:123`

### 2.3 Auth stack — `lib/stacks/auth.ts`

- `UserPool` — `FederateUserPool` (Midway-aware wrapper around `cognito.UserPool`; SRP + password + email-OTP + post-confirmation hydration trigger, `FeaturePlan.ESSENTIALS`) — `lib/stacks/auth.ts:32`
- `AdminUserPoolGroup` — `UserPoolGroup` — `lib/stacks/auth.ts:79`
- `UsersUserPoolGroup` — `UserPoolGroup` — `lib/stacks/auth.ts:83`
- `UserPoolClient` — `FederateUserPoolClient` (user-facing OIDC app client with auth-code grant, `openid email profile` scopes) — `lib/stacks/auth.ts:89`
- `GatewayResourceServer` — `userPool.addResourceServer` (OAuth2 resource server `{stackName}-gateway` with `read`/`write` scopes) — `lib/stacks/auth.ts:107`
- `MachineClient` — `userPool.addClient` (M2M client, `clientCredentials` flow, requests `{stackName}-gateway/read` + `/write`) — `lib/stacks/auth.ts:115`
- `MachineClientSecret` — `secretsmanager.Secret` (wraps the Cognito-generated client secret) — `lib/stacks/auth.ts:127`
- `IdentityPool` — `CfnIdentityPool` (authenticated identities only; bridges Cognito JWTs to SigV4 for AgentCore `InvokeAgentRuntimeWithWebSocketStream`) — `lib/stacks/auth.ts:139`
- `CognitoAuthenticatedRole` — `Role` (assumed via `sts:AssumeRoleWithWebIdentity`; grants `bedrock-agentcore:InvokeAgent` + `InvokeAgentRuntimeWithWebSocketStream`) — `lib/stacks/auth.ts:150`
- `IdentityPoolRoleAttachment` — `CfnIdentityPoolRoleAttachment` — `lib/stacks/auth.ts:180`
- `AdminUser` — `CfnUserPoolUser` — `lib/stacks/auth.ts:188` — **conditional** on `adminUserEmail !== null` (`null` in dev, so not provisioned)
- `RegionalWebAcl` — `CfnWebACL` (REGIONAL scope; IP rate-limit + AWS managed rules: Common, BotControl, KnownBadInputs, Unix, SQLi) — `lib/stacks/auth.ts:198`
- `UserPoolWebAclAssociation` — `CfnWebACLAssociation` (attaches `RegionalWebAcl` to the user pool) — `lib/stacks/auth.ts:254`
- `UserPoolDomain` — `userPool.addDomain` (hosted-UI domain `{stackName}-{account}-{region}.auth.{region}.amazoncognito.com`) — `lib/stacks/auth.ts:260`

### 2.4 Shared stack — `lib/stacks/shared.ts`

- `SessionsTable` — `dynamodb.Table` (PK `sessionId`, TTL attr `ttl`, on-demand) — `lib/stacks/shared.ts:47`
- `CustomersTable` — `dynamodb.Table` (PK `customerId`, on-demand) — `lib/stacks/shared.ts:57`
- `MetadataTable` — `dynamodb.Table` (PK `PK` + SK `SK`, TTL attr `ttl`, on-demand) — `lib/stacks/shared.ts:66`
- `ReportsBucket` — `s3.Bucket` (90-day lifecycle, GET CORS, S3-managed encryption; auto-ingestion triggers in 2.4.1) — `lib/stacks/shared.ts:79`
- `ImagesBucket` — `s3.Bucket` (30-day lifecycle, GET+PUT CORS) — `lib/stacks/shared.ts:91`
- `KbDocsBucket` — `s3.Bucket` (KB ingestion source) — `lib/stacks/shared.ts:101`
- `AvatarBucket` — `s3.Bucket` (30-day lifecycle, GET+PUT CORS) — `lib/stacks/shared.ts:106`

#### 2.4.1 Knowledge Base sub-tree — **conditional** on `features.knowledge_base && features.kb_backend === "s3-vectors"`

- `KbRole` — `iam.Role` (trust `bedrock.amazonaws.com`; grants `bedrock:InvokeModel` on embedding model + S3 Vectors data actions on index) — `lib/stacks/shared.ts:118`
- `KbSupplementalBucket` — `s3.Bucket` (stores supplemental multimodal data for KB) — `lib/stacks/shared.ts:123`
- `KbVectorBucket` — `s3vectors.CfnVectorBucket` — `lib/stacks/shared.ts:140`
- `KbVectorIndex` — `s3vectors.CfnIndex` (1024-dim, `float32`, cosine; marks `AMAZON_BEDROCK_TEXT` + `AMAZON_BEDROCK_METADATA` non-filterable) — `lib/stacks/shared.ts:144`
- `IamWaiterFunction` — `lambda.SingletonFunction` (inline Python 3.13 ARM64, sleeps 45s for IAM eventual consistency before KB create) — `lib/stacks/shared.ts:172`
- `IamPropagationWaiter` — `cdk.CustomResource` — `lib/stacks/shared.ts:184`
- `KnowledgeBase` — `bedrock.CfnKnowledgeBase` (type `VECTOR`, `S3_VECTORS` storage → `KbVectorIndex`, supplemental S3 storage → `KbSupplementalBucket`) — `lib/stacks/shared.ts:200`
- `KbDataSource` — `bedrock.CfnDataSource` (S3 source = `KbDocsBucket`, prefix `generated/`) — `lib/stacks/shared.ts:229`
- `KbIngestFunction` — `lambda.Function` (Python 3.13 ARM64, asset `gateway/tools/kb_ingest`, handler `handler.handler`, 60s timeout; copies reports→kb-docs with pipeline tags + calls `StartIngestionJob`) — `lib/stacks/shared.ts:279`
- `reportsBucket.addEventNotification` × 2 — S3 → `LambdaDestination(kbIngestLambda)` — filters: `prefix=reports/, suffix=.pdf` and `prefix=menus/, suffix=.pdf` — `lib/stacks/shared.ts:314` and `:319`

#### 2.4.2 Neptune sub-tree — **conditional** on `features.neptune` (OFF in dev)

- `NeptuneGraph` — `neptunegraph.CfnGraph` (`provisionedMemory=32`, vector search dim 1024) — `lib/stacks/shared.ts:330`

### 2.5 Backend stack — `lib/stacks/backend/index.ts`

- `AgentCoreRole` — `iam.Role` produced by `createAgentCoreRole()` in `lib/stacks/backend/agentcore-role.ts`. Composite trust on `bedrock-agentcore.amazonaws.com` + `bedrock.amazonaws.com`. Grants: ECR pull, CloudWatch Logs, X-Ray, CloudWatch metrics, Bedrock model invocation (incl. bidirectional stream + `ApplyGuardrail`), Secrets Manager (machine-client secret), SSM (`/{stackName}/*`), AgentCore Memory, DynamoDB (3 tables + metadata GSIs), S3 (reports+images+avatar), `bedrock-agentcore:InvokeRuntime`, Code Interpreter (`CreateCodeInterpreterSession`, `ExecuteCodeInterpreter`), Browser (`StartBrowserSession`, `Stop`, `Get`, `List`, `UpdateBrowserStream`, `ConnectBrowserAutomationStream`, `ConnectBrowserLiveViewStream`) — `lib/stacks/backend/index.ts:59` (+ all role policies in `agentcore-role.ts`)
- `AgentMemory` — `CfnResource` of type `AWS::BedrockAgentCore::Memory` (event expiry 30 days; strategies conditionally appended: `EpisodicMemoryStrategy` (w/ reflection), `SemanticMemoryStrategy`, `UserPreferenceMemoryStrategy`; execution role = `AgentCoreRole`) — `lib/stacks/backend/index.ts:116`
- `GatewayRole` — `iam.Role` (trust `bedrock-agentcore.amazonaws.com`; grants Bedrock model invocation, Logs, and `lambda:InvokeFunction` on `function:{stackName}-tool-*`) — `lib/stacks/backend/index.ts:144`
- Tool Lambdas (loop over `toolDefs`, see section 4) — `lib/stacks/backend/index.ts:266+`
    - Each tool also creates a `LogGroup` `/aws/lambda/{stackName}-tool-{dir}` with 1-week retention
    - Each tool receives grants on all 3 DynamoDB tables + all 3 S3 buckets + Bedrock + AgentCore wildcard
    - `kb_search` additionally grants `KbDocsBucket.read`
    - `recall_memories` + `save_memory` additionally grant `RetrieveMemoryRecords` / event APIs on `AgentMemory`
- `Gateway` — `bedrockagentcore.CfnGateway` (protocol `MCP` v `2025-03-26`, `CUSTOM_JWT` authorizer pointing at the Cognito issuer, `allowedClients = [MachineClient.userPoolClientId]`) — `lib/stacks/backend/index.ts:352`
- `Target_{toolDir}` — `bedrockagentcore.CfnGatewayTarget` × 18 (one per tool Lambda, each using `GATEWAY_IAM_ROLE` credentials and inline tool schema from `tool_spec.json`) — `lib/stacks/backend/index.ts:378`
- `Runtime_orchestrator` — `@aws-cdk/aws-bedrock-agentcore-alpha.Runtime` (L2 construct). Artifact built from repo-root Dockerfile `patterns/orchestrator-agent/Dockerfile` for `LINUX_ARM64`. Protocol HTTP, public network, JWT authorizer (user-facing `UserPoolClient`), env vars include `MEMORY_ID`, `MODEL_ID=us.anthropic.claude-sonnet-4-6`, `STACK_NAME`; allowlists `Authorization` header — `lib/stacks/backend/index.ts:429`
- `AvatarImage` — `ecr-assets.DockerImageAsset` for `patterns/avatar-agent/Dockerfile` (LINUX_ARM64) — `lib/stacks/backend/index.ts:464` — **conditional** on `features.avatar`
- `Runtime_avatar` — `bedrockagentcore.CfnRuntime` (L1). `containerUri = AvatarImage.imageUri`, HTTP protocol, PUBLIC network, env vars include `MEMORY_ID`, `MODEL_ID=amazon.nova-2-sonic-v1:0`, `TOOL_SELECTOR_MODEL_ID=amazon.nova-2-lite-v1:0`, `PERSONA=friendly` — `lib/stacks/backend/index.ts:470` — **conditional** on `features.avatar`
- `FeedbackTable` — `dynamodb.Table` (PK `feedbackId`, on-demand, AWS-managed KMS) — `lib/stacks/backend/index.ts:499`
- FeedbackTable GSI — `feedbackType-timestamp-index` (PK `feedbackType`, SK `timestamp`) — `lib/stacks/backend/index.ts:509`
- `FeedbackLogGroup` — `logs.LogGroup` (1 wk retention) — `lib/stacks/backend/index.ts:520`
- `FeedbackLambda` — `lambda.Function` (Python 3.13 ARM64, asset `lib/lambdas/feedback`, 300s timeout) — `lib/stacks/backend/index.ts:526`
- `FeedbackApi` — `apigateway.RestApi` (CORS allow all origins, methods GET/POST/PATCH/DELETE/OPTIONS, method-level Cognito authorizer) — `lib/stacks/backend/index.ts:565`
- `FeedbackApiWafAssociation` — `wafv2.CfnWebACLAssociation` (attaches Auth stack's `RegionalWebAcl` to the API stage) — `lib/stacks/backend/index.ts:592`
- `ApiAuthorizer` — `apigateway.CognitoUserPoolsAuthorizer` — `lib/stacks/backend/index.ts:597`
- `KbResetLogGroup` — `logs.LogGroup` — `lib/stacks/backend/index.ts:611` — **conditional** on `features.knowledge_base && kbId && kbDataSourceId`
- `KbResetLambda` — `lambda.Function` (Python 3.13 ARM64, asset `lib/lambdas/kb-reset`, 60s timeout; deletes all `KbDocsBucket` objects then `StartIngestionJob`) — `lib/stacks/backend/index.ts:617` — **conditional** same as above
- `/feedback` and `/kb-reset` POST methods on the API — `lib/stacks/backend/index.ts:602`, `:655`
- `Guardrail` — `bedrock.CfnGuardrail` (content filters SEXUAL/VIOLENCE/HATE/INSULTS/MISCONDUCT/PROMPT_ATTACK; DENY topic `politics_and_elections`; managed PROFANITY word list) — `lib/stacks/backend/index.ts:681` — **conditional** on `features.guardrails`
- `Tool_research_orchestrator` — `lambda.Function` + dedicated `LogGroup` (Python 3.13 ARM64, 15 min timeout, 512 MB; env has `RUNTIME_ARN_ORCHESTRATOR`/`RUNTIME_ARN_AVATAR`) — `lib/stacks/backend/index.ts:728` — **conditional** on `features.durable_functions` (OFF in dev)

---

## 3. AgentCore runtimes and sub-agents

Only two runtimes deploy (`orchestrator` + `avatar`). The other four "agents" are **in-process Strands `Agent` instances** constructed inside the orchestrator runtime — they share one MCP client and do not have their own runtime/Docker image. Their folders contain the prompts and helper functions that the orchestrator imports at build time.

| Pattern folder                 | Runtime?                                                                       | Entry file                                                 | Docker                                   | Framework / model                                                                                                                                                   | MCP tools                                                                                                                                                                                                                    | Hooks                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `patterns/orchestrator-agent/` | **Yes** (`Runtime_orchestrator`, HTTP/SSE)                                     | `orchestrator_agent.py` (1 871 lines) + `browser_tools.py` | `patterns/orchestrator-agent/Dockerfile` | Strands `Agent` + `BedrockModel` (Claude Sonnet 4.6 via `MODEL_ID`); MCP client = `streamablehttp_client` to Gateway; session mgr = `AgentCoreMemorySessionManager` | Gateway MCP client (all 18 tools) + local Strands `@tool` list `BROWSER_TOOLS` = `browser_start, browser_navigate, browser_click, browser_type, browser_get_text, browser_press_key, browser_stop` (from `browser_tools.py`) | `UserScopeHook` (injects verified `user_id`), `PipelineScopeHook` (scopes KB reads + PDF writes by mode) |
| `patterns/avatar-agent/`       | **Yes** (`Runtime_avatar`, HTTP; uses `InvokeAgentRuntimeWithWebSocketStream`) | `avatar_agent.py`                                          | `patterns/avatar-agent/Dockerfile`       | Strands `experimental.bidi.BidiAgent` + `BidiNovaSonicModel` (`amazon.nova-2-sonic-v1:0`); tool selector = Nova Lite                                                | Gateway MCP client only (no local tools)                                                                                                                                                                                     | Inherits runtime auth; 5 selectable personas in `persona_prompts.py`                                     |
| `patterns/planner-agent/`      | No (in-process)                                                                | `planner_agent.py`                                         | —                                        | Strands `Agent` + `BedrockModel`                                                                                                                                    | Gateway MCP client only                                                                                                                                                                                                      | —                                                                                                        |
| `patterns/researcher-agent/`   | No (in-process)                                                                | `researcher_agent.py`                                      | —                                        | Strands `Agent` + `BedrockModel`                                                                                                                                    | Gateway MCP client only                                                                                                                                                                                                      | —                                                                                                        |
| `patterns/synthesizer-agent/`  | No (in-process)                                                                | `synthesizer_agent.py`                                     | —                                        | Strands `Agent` + `BedrockModel` (10 000-token thinking budget)                                                                                                     | Gateway MCP client only                                                                                                                                                                                                      | —                                                                                                        |
| `patterns/pdf-writer-agent/`   | No (in-process)                                                                | `pdf_writer_agent.py`                                      | —                                        | Strands `Agent` + `BedrockModel`                                                                                                                                    | Gateway MCP client only                                                                                                                                                                                                      | —                                                                                                        |

Shared helpers live in `patterns/utils/` — `auth.py` (M2M token exchange + user-id extraction), `ssm.py`, `heartbeat.py` (10s SSE keepalive), `tool_guard.py` (`UserScopeHook`), `pipeline_scope.py` (`PipelineScopeHook` + `mode_config`), `responses_api.py`.

### Orchestrator modes → pipelines

Routing lives in `patterns/orchestrator-agent/orchestrator_agent.py` (`_handle_chatbot` / `_run_plan_only` / `_run_pipeline` + `AGENT_PHASES` / `MENU_PHASES` / `GENERIC_RESEARCH_PHASES`).

| `payload.mode`             | Entry line | Sub-agents invoked (in order)                                                                                                                        | Phases constant                                                        |
| -------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `research` (default)       | `:1611`    | `planner` only (emits plan JSON for user approval)                                                                                                   | `AGENT_PHASES[planner]` via `_run_plan_only`                           |
| `research_execute`         | `:1617`    | `researcher` → `synthesizer` → `pdf_writer` (planner stripped)                                                                                       | `RESEARCH_EXECUTION_PHASES` (= `AGENT_PHASES` minus planner)           |
| `generic_research`         | `:1582`    | `planner` only (topic-agnostic)                                                                                                                      | `GENERIC_RESEARCH_PHASES[planner]` via `_run_plan_only`                |
| `generic_research_execute` | `:1588`    | `researcher` (enhanced, images + data sources) → `synthesizer` → `pdf_writer`                                                                        | `GENERIC_EXECUTION_PHASES` (= `GENERIC_RESEARCH_PHASES` minus planner) |
| `menu`                     | `:1640`    | `menu_designer` (Nova Canvas) → `menu_pdf_writer` (or `menu_website_writer`)                                                                         | `MENU_PHASES`                                                          |
| `chatbot`                  | `:1576`    | Single Strands `Agent` (conversational) + `BROWSER_TOOLS`; Bedrock Guardrails attached via `_load_guardrail_params`; PipelineScope limited to `menu` | — (no phased pipeline)                                                 |
| `archive_chat`             | `:1563`    | Single Strands `Agent` with `ARCHIVE_CHAT_PROMPT`, KB read scope unrestricted                                                                        | —                                                                      |

---

## 4. Gateway MCP tools

`toolDefs` array in `lib/stacks/backend/index.ts:217-247` drives a loop that builds 18 tool Lambdas + 18 `CfnGatewayTarget`s. All runtimes: **Python 3.13 + ARM64**, handler env vars include `AWS_ACCOUNT_ID`, the 3 DynamoDB table names, the 3 S3 bucket names, `MEMORY_ID`, `MEMORY_STRATEGY_ID=default`, and `KNOWLEDGE_BASE_ID` (when KB is on).

| #   | tool_dir                | Gateway target name     | Handler                      | Timeout | Memory | Description (from `tool_spec.json`)                                                                                                                                                                                       |
| --- | ----------------------- | ----------------------- | ---------------------------- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `kb_search`             | `kb-search`             | `handler.handler`            | 300 s   | 256 MB | Search an Amazon Bedrock Knowledge Base for relevant documents using hybrid vector and keyword search. Returns formatted results with citations. Optional `pipelines` scope (`bistro_research`, `open_research`, `menu`). |
| 2   | `web_search`            | `web-search`            | `handler.handler`            | 300 s   | 256 MB | Search the web for up-to-date information using Amazon Nova grounding. Returns URLs + snippets.                                                                                                                           |
| 3   | `pdf_generator`         | `pdf-generator`         | `handler.handler`            | 900 s   | 512 MB | Generate a formatted PDF (ReportLab) and upload to S3; returns presigned URL. Supports `research` (12-section) and `menu` formats. Tags S3 object metadata with `pipeline`.                                               |
| 4   | `nova_canvas_generate`  | `nova-canvas-generate`  | `handler.handler`            | 300 s   | 512 MB | Generate a new image from a text prompt using Amazon Nova Canvas; saves to S3 and returns presigned URL.                                                                                                                  |
| 5   | `nova_canvas_edit`      | `nova-canvas-edit`      | `handler.handler`            | 300 s   | 512 MB | Edit an existing image via Nova Canvas — inpaint, outpaint, background removal, variations.                                                                                                                               |
| 6   | `nova_canvas_history`   | `nova-canvas-history`   | `handler.handler`            | 60 s    | 128 MB | Retrieve image generation history for a session with fresh presigned URLs.                                                                                                                                                |
| 7   | `nova_reel_generate`    | `nova-reel-generate`    | `handler.handler`            | 300 s   | 256 MB | Generate a video from a text prompt via Nova Reel (async, returns invocation ARN). 6–120 s @ 24 fps, 1280×720.                                                                                                            |
| 8   | `nova_reel_status`      | `nova-reel-status`      | `handler.handler`            | 60 s    | 128 MB | Check status of an async Nova Reel job; returns presigned URL if complete.                                                                                                                                                |
| 9   | `nova_reel_history`     | `nova-reel-history`     | `handler.handler`            | 60 s    | 128 MB | Retrieve video generation history for a session with current job statuses + presigned URLs.                                                                                                                               |
| 10  | `save_memory`           | `save-memory`           | `handler.handler`            | 300 s   | 256 MB | Persist a fact/preference/context to AgentCore Memory (the tool_spec still references Neptune verbally; actual storage is `AgentMemory`).                                                                                 |
| 11  | `recall_memories`       | `recall-memories`       | `handler.handler`            | 300 s   | 256 MB | Retrieve saved memories from AgentCore Memory with optional query filter.                                                                                                                                                 |
| 12  | `analyze_patterns`      | `analyze-patterns`      | `handler.handler`            | 300 s   | 256 MB | Analyze conversation patterns and trends via Neptune/Memory analytics queries.                                                                                                                                            |
| 13  | `retrieve_user_profile` | `retrieve-user-profile` | `handler.handler`            | 60 s    | 128 MB | Retrieve the current user's profile from DynamoDB (`CustomersTable`).                                                                                                                                                     |
| 14  | `place_order`           | `place-order`           | `handler.handler`            | 300 s   | 256 MB | Place a food/drink order at Ocean View Bistro (writes to `MetadataTable`).                                                                                                                                                |
| 15  | `data_sources`          | `data-sources`          | `handler.handler`            | 30 s    | 128 MB | Query public data sources (Wikipedia, arXiv) — no API keys required.                                                                                                                                                      |
| 16  | `website_generator`     | `website-generator`     | `handler.handler`            | 900 s   | 512 MB | Generate or update a static website on S3 (layouts: `article`, `landing`, `menu`); `create` / `update` (+ `edit_instructions`) / `add_images` modes.                                                                      |
| 17  | `extract_pdf_images`    | `extract-pdf-images`    | `handler.handler`            | 900 s   | 256 MB | Extract dish images from a menu PDF via **AgentCore Code Interpreter**; returns `{name, s3_key}[]` for `website_generator add_images`.                                                                                    |
| 18  | `sample_tool`           | `sample-tool`           | `sample_tool_lambda.handler` | 300 s   | 128 MB | Reference implementation — text analyzer counting words and top-N chars (internal name `text_analysis_tool`).                                                                                                             |

**Not Gateway-registered:**

| #   | tool_dir                | Handler           | Timeout        | Memory           | Wiring                                                                                                                                                                                                                                                                                |
| --- | ----------------------- | ----------------- | -------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19  | `kb_ingest`             | `handler.handler` | 60 s           | default (128 MB) | Built as `KbIngestFunction` in Shared stack. S3-event-triggered by `ReportsBucket` `ObjectCreated` notifications on `reports/*.pdf` and `menus/*.pdf`. Copies to `KbDocsBucket/generated/...` with pipeline tags, writes `.metadata.json` sidecar, calls `bedrock:StartIngestionJob`. |
| 20  | `research_orchestrator` | `handler.handler` | 900 s (15 min) | 512 MB           | Built as `Tool_research_orchestrator` Lambda in Backend only when `features.durable_functions` is `true` (OFF in dev). Env includes every runtime ARN; has `bedrock-agentcore:InvokeRuntime` on them. Gateway invoke grant wired but the target is not registered in dev.             |

---

## 5. Edges (directed, deduped)

Edges the regenerated diagram must render. Grouped by origin; `(label)` notes are free-form annotations that can become arrow labels.

### 5.1 User + Frontend hosting

- `User → CloudFront Distribution (HTTPS)`
- `CloudFront Distribution → WebsiteBucket (S3 OAC origin)`
- `CloudFront Distribution → LoggingBucket (access logs)`
- `CloudFront Distribution ← CloudfrontWebAcl (WAF, global)`
- `WebsiteBucket ← CodeBuild / StaticWebsiteBuild (build+upload at deploy time)`
- `StaticWebsiteBuild → CloudFront Distribution (cache invalidation)`

### 5.2 Auth (OIDC + M2M)

- `Frontend (browser) → Cognito UserPool / UserPoolDomain (OIDC auth-code flow)`
- `Frontend → Cognito IdentityPool (exchange JWT for AWS SigV4 creds)`
- `Cognito IdentityPool → CognitoAuthenticatedRole (assume role)`
- `Cognito UserPool ← RegionalWebAcl (WAF, regional)`
- `Cognito UserPool → Lambda hydrationFunction (PostConfirmation trigger; present in auth construct interface, not wired in dev)`
- `Orchestrator Runtime → Cognito MachineClient (client-credentials grant via MachineClientSecret)`
- `Avatar Runtime → Cognito MachineClient (same M2M flow)`
- `MachineClientSecret ← AgentCoreRole (secretsmanager:GetSecretValue)`

### 5.3 Runtime invocation

- `Frontend → Orchestrator Runtime (HTTP + SSE, OIDC token on Authorization header)`
- `Frontend → Avatar Runtime (WebSocket via bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream)`
- `Frontend → FeedbackApi (REST, Cognito authorizer)`
- `FeedbackApi ← RegionalWebAcl (WAF via FeedbackApiWafAssociation)`
- `FeedbackApi → FeedbackLambda → FeedbackTable (+ feedbackType-timestamp-index GSI)`
- `FeedbackApi → KbResetLambda (conditional /kb-reset route)`
- `KbResetLambda → KbDocsBucket (list/delete) + Bedrock KnowledgeBase (StartIngestionJob)`

### 5.4 Orchestrator Runtime → dependencies

- `Orchestrator Runtime → Gateway (MCP over HTTPS, M2M JWT)`
- `Orchestrator Runtime → AgentMemory (CreateEvent / GetEvent / ListEvents / RetrieveMemoryRecords)`
- `Orchestrator Runtime → SSM Parameter Store (/{stackName}/*)`
- `Orchestrator Runtime → Bedrock (Claude Sonnet 4.6 invoke + ApplyGuardrail)`
- `Orchestrator Runtime → Guardrail (applied to chatbot mode)`
- `Orchestrator Runtime → AgentCore Browser (StartBrowserSession / DCV streams / Playwright CDP)`
- `Orchestrator Runtime → AgentCore Code Interpreter (CreateCodeInterpreterSession / ExecuteCodeInterpreter)` — note: the `extract_pdf_images` tool Lambda also invokes Code Interpreter (edge below)
- `Frontend (BrowserLiveViewSidebar) → AgentCore Browser (DCV WebSocket live view)`

### 5.5 Avatar Runtime → dependencies

- `Avatar Runtime → Gateway (MCP)`
- `Avatar Runtime → AgentMemory`
- `Avatar Runtime → Bedrock Nova 2 Sonic (bidirectional stream)`
- `Avatar Runtime → Bedrock Nova 2 Lite (tool selector)`
- `Avatar Runtime → AvatarBucket (S3 read/write)`

### 5.6 Gateway → tool Lambdas (18 edges)

For each tool in section 4 rows 1–18: `Gateway → Tool_{dir} Lambda (lambda:InvokeFunction via GatewayRole)`. Each tool target is registered by `CfnGatewayTarget`.

### 5.7 Tool Lambdas → AWS data plane

- `Tool_kb_search → Bedrock KnowledgeBase (Retrieve / RetrieveAndGenerate) + KbDocsBucket (read)`
- `Tool_web_search → Bedrock (Nova with web grounding)`
- `Tool_pdf_generator → ReportsBucket (put object with pipeline metadata)`
- `Tool_nova_canvas_generate → Bedrock Nova Canvas + ImagesBucket (put)`
- `Tool_nova_canvas_edit → Bedrock Nova Canvas + ImagesBucket (read/put)`
- `Tool_nova_canvas_history → ImagesBucket + MetadataTable`
- `Tool_nova_reel_generate → Bedrock Nova Reel (StartAsyncInvoke) + ImagesBucket`
- `Tool_nova_reel_status → Bedrock (GetAsyncInvoke)`
- `Tool_nova_reel_history → MetadataTable + ImagesBucket`
- `Tool_save_memory → AgentMemory (CreateEvent)`
- `Tool_recall_memories → AgentMemory (RetrieveMemoryRecords / ListEvents)`
- `Tool_analyze_patterns → AgentMemory (+ Neptune when feature enabled)`
- `Tool_retrieve_user_profile → CustomersTable`
- `Tool_place_order → MetadataTable + CustomersTable`
- `Tool_data_sources → Wikipedia + arXiv (external, read-only)`
- `Tool_website_generator → ReportsBucket + ImagesBucket`
- `Tool_extract_pdf_images → ReportsBucket (read PDF) + AgentCore Code Interpreter (sandbox execution) + ImagesBucket (put extracted dish images)`

### 5.8 Shared/S3 auto-ingestion

- `ReportsBucket → KbIngestFunction (S3 ObjectCreated, prefix reports/, suffix .pdf)`
- `ReportsBucket → KbIngestFunction (S3 ObjectCreated, prefix menus/, suffix .pdf)`
- `KbIngestFunction → KbDocsBucket (put generated/... + .metadata.json sidecar + tags)`
- `KbIngestFunction → Bedrock KnowledgeBase (StartIngestionJob on KbDataSource)`
- `Bedrock KnowledgeBase → KbVectorIndex (S3 Vectors query/write via KbRole)`
- `KnowledgeBase → KbSupplementalBucket (multimodal supplemental storage)`
- `KbDataSource → KbDocsBucket (ingest prefix `generated/`)`

### 5.9 README-derived edges (already covered above, listed here for diagram completeness — deduped against 5.1–5.8)

From the top-level Architecture mermaid in `README.md`:

- `User → UI`
- `UI → Orchestrator Runtime (OIDC Token)`
- `UI → Avatar Runtime (OIDC Token)`
- `Orchestrator Runtime → Gateway (M2M OAuth2)`
- `Avatar Runtime → Gateway (M2M OAuth2)`
- `Gateway → Tool Lambdas`
- `Tool Lambdas → Knowledge Base`
- `Tool Lambdas → S3`
- `Tool Lambdas → DynamoDB`
- `Orchestrator Runtime → Memory`
- `Orchestrator Runtime ⇢ Guardrails (Chatbot mode; dashed)`
- `Orchestrator Runtime ⇢ Browser (Chatbot mode; dashed)`
- `Gateway ⇢ Code Interpreter (via extract_pdf_images; dashed)`
- `Avatar Runtime → Memory`

From the multi-agent pipeline mermaid — represent as intra-Orchestrator sub-flow (all in-process):

- `Orchestrator → Planner Agent`
- `Planner → Gateway (kb_search)`
- `Planner → Orchestrator (Research plan JSON)`
- `Orchestrator ⇢ Frontend (SSE: ResearchPlan card)`
- `Orchestrator → Researcher Agent`
- `Researcher → Gateway (kb_search + web_search per question)`
- `Orchestrator → Synthesizer Agent`
- `Orchestrator → PDF Writer Agent`
- `PDF Writer → Gateway (pdf_generator)`
- `Orchestrator ⇢ Frontend (SSE: PDF download card)`

From the concierge / browser sequence diagram:

- `Orchestrator → browser_tools.py (in-process @tool)`
- `browser_tools.py → AgentCore Browser (start_browser_session)`
- `browser_tools.py → Playwright CDP → AgentCore Browser (automate)`
- `Orchestrator ⇢ Frontend (SSE: BrowserLiveView event with DCV URL)`
- `Frontend → AgentCore Browser (DCV WebSocket live stream)`
- `Frontend → ConciergeFlowSidebar (mark Runtime + Gateway + Memory + Browser + Code Interpreter nodes active)`

---

## 6. Model IDs

From `lib/common/feature-flags.ts` `DEFAULT_MODELS` (lines 46–51) — `cdk.json → context.models` currently mirrors these exact values, so effective dev = defaults.

| Role                   | Bedrock model ID                           | Source                                                                                                 |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `orchestrator`         | `us.anthropic.claude-sonnet-4-6`           | `lib/common/feature-flags.ts:47` → passed to `Runtime_orchestrator` env var `MODEL_ID`                 |
| `avatar_sonic`         | `amazon.nova-2-sonic-v1:0`                 | `lib/common/feature-flags.ts:48` → passed to `Runtime_avatar` env var `MODEL_ID`                       |
| `avatar_tool_selector` | `amazon.nova-2-lite-v1:0`                  | `lib/common/feature-flags.ts:49` → passed to `Runtime_avatar` env var `TOOL_SELECTOR_MODEL_ID`         |
| `kb_embedding`         | `amazon.nova-2-multimodal-embeddings-v1:0` | `lib/common/feature-flags.ts:50` → used for `CfnKnowledgeBase.embeddingModelArn` + granted on `KbRole` |

---

## 7. What the current `architecture.drawio.png` is missing

The current diagram depicts only the **Frontend** and **FrontendDeployment** stacks (CloudFront + WebsiteBucket + LoggingBucket + CloudfrontWebAcl + CodeBuild + Cognito UserPool). The regenerated diagram must add every item below.

### 7.1 Missing stacks

- **Shared stack** (entire contents listed below)
- **Backend stack** (entire contents listed below)
- The Auth stack appears only partially today (just UserPool) — regenerate with the full Auth surface below.

### 7.2 Missing Auth resources

- IdentityPool + CognitoAuthenticatedRole (authenticated role with `bedrock-agentcore:InvokeAgent`)
- GatewayResourceServer + MachineClient (M2M OAuth2 app client) + MachineClientSecret (Secrets Manager)
- RegionalWebAcl (REGIONAL scope WAF) + UserPoolWebAclAssociation + FeedbackApiWafAssociation
- UserPoolDomain (hosted UI) + UserPoolClient (user-facing OIDC app client)
- Admin/Users `UserPoolGroup`s

### 7.3 Missing Shared resources

- SessionsTable, CustomersTable, MetadataTable (DynamoDB)
- ReportsBucket, ImagesBucket, KbDocsBucket, AvatarBucket (S3)
- KnowledgeBase (`AWS::Bedrock::KnowledgeBase`) + KbDataSource + KbRole + KbSupplementalBucket
- KbVectorBucket + KbVectorIndex (S3 Vectors, 1024-dim cosine)
- IamWaiterFunction + IamPropagationWaiter (IAM eventual-consistency waiter)
- **KbIngestFunction** (S3-triggered Lambda) plus the two S3 ObjectCreated notifications from ReportsBucket
- NeptuneGraph (feature-gated, not in dev, but diagram should show as optional)

### 7.4 Missing Backend resources

- AgentCoreRole (shared execution role for both runtimes, with Browser + Code Interpreter + Memory + Bedrock + DynamoDB + S3 grants)
- AgentMemory (`AWS::BedrockAgentCore::Memory`) with three strategies: Episodic (w/ reflection), Semantic, UserPreference
- GatewayRole
- **Gateway** (`CfnGateway`, MCP protocol, CUSTOM_JWT authorizer scoped to MachineClient)
- 18 Tool Lambdas (one per section-4 row) and their 18 `CfnGatewayTarget`s
- 18 per-tool CloudWatch LogGroups under `/aws/lambda/{stackName}-tool-*`
- **Runtime_orchestrator** (AgentCore Runtime, HTTP) + its Docker image (`patterns/orchestrator-agent/Dockerfile`)
- **Runtime_avatar** (AgentCore Runtime, HTTP for WS upgrade) + AvatarImage (`DockerImageAsset`)
- FeedbackTable (+ GSI `feedbackType-timestamp-index`) + FeedbackLambda + FeedbackApi (API Gateway REST, Cognito authorizer)
- KbResetLambda + `/kb-reset` API route (conditional)
- **Guardrail** (`CfnGuardrail`) with content + topic + word policies
- `Tool_research_orchestrator` (feature-gated, not in dev)

### 7.5 Missing AgentCore-managed primitives (rendered but not owned by any CDK resource)

- **AgentCore Browser microVM** (invoked at runtime, not defined in CDK — grants are on `AgentCoreRole`)
- **AgentCore Code Interpreter sandbox** (invoked by orchestrator + by the `extract_pdf_images` tool Lambda)
- **Nova Canvas**, **Nova Reel**, **Nova Sonic**, **Nova Lite**, **Nova Multimodal Embeddings**, **Claude Sonnet 4.6** Bedrock models (edges from runtimes/tool Lambdas to these foundation models)

### 7.6 Missing edges

Every edge listed in section 5 is absent from the current PNG. Highest-priority additions:

- Frontend → Orchestrator Runtime (HTTP/SSE) and Frontend → Avatar Runtime (WebSocket)
- Orchestrator/Avatar Runtimes → Gateway (MCP, M2M)
- Gateway → each of the 18 tool Lambdas
- Tool Lambdas → DynamoDB tables, S3 buckets, Bedrock models
- ReportsBucket → KbIngestFunction → KbDocsBucket → KnowledgeBase → KbVectorIndex
- Runtimes → AgentMemory + Bedrock models
- Orchestrator → AgentCore Browser + AgentCore Code Interpreter
- Frontend → AgentCore Browser (DCV live view stream)
- FeedbackApi → FeedbackLambda → FeedbackTable; KbResetLambda → KbDocsBucket + KnowledgeBase
- Cognito IdentityPool → CognitoAuthenticatedRole; Cognito UserPool ← RegionalWebAcl (plus FeedbackApi ← same WAF)
