# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Multi-agent research platform built on Amazon Bedrock AgentCore + Strands Agents SDK + React 19. Two AgentCore Runtimes (orchestrator + avatar), an MCP Gateway with Lambda tools, multi-agent research pipelines, Knowledge Base (S3 Vectors), AgentCore Memory, Bedrock Guardrails, and a Cloudscape + Tailwind frontend. Deployed as 5 CDK stacks.

## Common Commands

```bash
npm install                      # Install all deps (also sets up Python venv via uv, installs ruff)
npm run kit                      # Interactive CLI for all operations (credentials, deploy, destroy, etc.)
npm run kit -- deploy [stage] --all   # Deploy all stacks headlessly
npm run kit -- synth [stage]          # Synthesize + cdk-nag validation
npm run kit -- hotswap [stage] --all  # Fast Lambda/asset deployment
npm run kit -- destroy [stage]        # Destroy stacks (interactive selection)
npm run build                    # TypeScript compilation (tsc)
npm run test                     # Jest tests (from test/ directory)
npm run lint                     # ESLint + ruff check
npm run format                   # Prettier + ruff format
npm run commit                   # Interactive conventional commit (commitizen)
npm run -w frontend dev          # Vite dev server on :3000
npm run -w frontend build        # Build frontend (tsc -b && vite build)
npm run cdk -- <command>         # Direct CDK CLI (pinned to 2.1108.0)
```

## Architecture

### CDK 5-Stack Pattern

```
bin/app.ts → lib/stage.ts (ApplicationStage)
  ├── Frontend         — S3 + CloudFront (OAC) + WAF (CloudFront scope)
  ├── Auth             — Cognito User Pool/Client/Identity Pool + M2M OAuth2 + WAF (Regional)
  ├── Shared           — DynamoDB (3 tables) + S3 (4 buckets) + Knowledge Base (S3 Vectors) + Neptune (optional)
  ├── Backend          — AgentCore Gateway (MCP, 17 tools) + 2 Runtimes + Memory + Guardrails + Feedback API
  └── FrontendDeployment — CodeBuild builds React app in-cloud, deploys to S3
```

**Deployment order**: Frontend + Auth deploy in parallel. Backend depends on Shared + Auth. FrontendDeployment must be last (consumes cross-stack env vars).

**Stack naming**: `{stage}/{projectId}-{StackId}` — the custom `Stack` base class (`lib/common/constructs/stack.ts`) auto-prefixes with `projectId` from `cdk.json`.

### 2 AgentCore Runtimes

| Runtime      | Protocol  | Model                                      | Purpose                                                                                        |
| ------------ | --------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Orchestrator | HTTP/SSE  | Claude Sonnet 4.6                          | 6 modes: research, research_execute, menu, chatbot, generic_research, generic_research_execute |
| Avatar       | WebSocket | Nova 2 Sonic + Nova 2 Lite (tool selector) | Real-time voice conversation with 5 selectable personas                                        |

### Multi-Agent Pipeline (In-Process)

All agents run in-process within the orchestrator runtime. No HTTP between agents.

**Research pipeline** (2-request pattern for human-in-the-loop):

1. Request 1 (`mode=research`): Planner Agent → emits plan JSON for user review/edit
2. Request 2 (`mode=research_execute`): Researcher → Synthesizer → PDF Writer → 12-section PDF report

**Menu pipeline** (`mode=menu`): Menu Designer → Menu PDF Writer (with Stability SD3.5 product images)

**Chatbot** (`mode=chatbot`): Single conversational agent with Bedrock Guardrails applied at model level.

### Gateway — MCP Lambda Tools

All Lambda tools: Python 3.13, ARM64, auto-bundled with `requirements.txt` during synth.

| Tool                    | Memory | Timeout | Purpose                                     |
| ----------------------- | ------ | ------- | ------------------------------------------- |
| `kb_search`             | 256 MB | 5 min   | Bedrock Knowledge Base hybrid search        |
| `kb_ingest`             |        |         | S3 event → copy to KB bucket → start ingest |
| `web_search`            | 256 MB | 5 min   | Nova Pro with web grounding                 |
| `pdf_generator`         | 512 MB | 15 min  | ReportLab PDF generation → S3 presigned URL |
| `image_generate`        | 512 MB | 5 min   | Image generation via Stability SD3.5        |
| `image_history`         | 128 MB | 1 min   | Session image history                       |
| `save_memory`           | 256 MB | 5 min   | Persist to AgentCore Memory                 |
| `recall_memories`       | 256 MB | 5 min   | Retrieve from AgentCore Memory              |
| `analyze_patterns`      | 256 MB | 5 min   | Conversation pattern analysis               |
| `retrieve_user_profile` | 128 MB | 1 min   | DynamoDB customer lookup                    |
| `place_order`           | 256 MB | 5 min   | Order placement                             |
| `data_sources`          | 128 MB | 30 s    | Data source listings                        |
| `sample_tool`           | 128 MB | 1 min   | Example tool template                       |

Feature-gated: `research_orchestrator` (Lambda Durable Functions, `features.durable_functions`).

### AgentCore Memory

3 strategy types (each feature-gated):

- **Episodic** (`features.episodic_memory`): Session-scoped with reflection
- **Semantic** (`features.semantic_memory`): Cross-session fact extraction
- **User Preference** (`features.user_preference_memory`): Research preferences and patterns

Event expiry: 30 days. Integrated via `AgentCoreMemorySessionManager` from `bedrock-agentcore` SDK.

### Knowledge Base

Single physical Bedrock KB (S3 Vectors backend with Nova Multimodal Embeddings, 1024-dim, FLOAT32, cosine) with three logical views tagged by `pipeline` metadata:

| Pipeline tag      | Writer                                        | Readers                                                               |
| ----------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| `bistro_research` | Bistro Deep Dive (mode=research_execute)      | Bistro Deep Dive planner, Menu Designer, Report Archive, Voice Avatar |
| `open_research`   | Open Research (mode=generic_research_execute) | Open Research planner, Menu Designer, Report Archive, Voice Avatar    |
| `menu`            | Menu Builder (mode=menu)                      | AI Concierge (chatbot), Report Archive, Voice Avatar                  |

Mode → pipeline mapping is centralized in `patterns/utils/pipeline_scope.py::MODE_PIPELINE_CONFIG`:

```python
{
    "research":                  {"write": "bistro_research", "read_filter": ["bistro_research"]},
    "research_execute":          {"write": "bistro_research", "read_filter": ["bistro_research"]},
    "generic_research":          {"write": "open_research",   "read_filter": ["open_research"]},
    "generic_research_execute":  {"write": "open_research",   "read_filter": ["open_research"]},
    "menu":                      {"write": "menu",            "read_filter": ["bistro_research", "open_research"]},
    "chatbot":                   {"write": None,              "read_filter": ["menu"]},
    "archive_chat":              {"write": None,              "read_filter": None},  # no filter
}
```

The runtime injects read filter + write pipeline via a `PipelineScopeHook` (Strands `BeforeToolCallEvent`). The LLM cannot cross boundaries even if it tries.

**Voice Avatar** is the only experience whose scope is user-controlled. The frontend sends `kb_pipelines` in the presigned WebSocket URL query string (comma-separated) for the initial scope, and a `{type: "kbPipelinesChange", kbPipelines: [...]}` JSON message for mid-session changes. The avatar backend holds the selection in a single-element mutable list that the PipelineScopeHook reads on every tool call, so mid-session toggles apply to the very next `kb_search`.

**Ingestion**: S3 event notifications on reports bucket (`reports/*.pdf`, `menus/*.pdf`) trigger `kb_ingest` Lambda → reads `pipeline` from source object metadata (falling back to prefix-based inference; legacy `research` → `bistro_research`) → copies to kb-docs bucket with `pipeline=<value>` tag + `.metadata.json` sidecar → starts ingestion job.

**KB Reset**: available via REST API (`POST /kb-reset`).

### Verifying KB Filters

Quick smoke-test to confirm the filter shapes in CloudWatch logs:

```bash
# Filter by pipeline only (multi-value -> uses `in` operator)
aws lambda invoke --function-name <stack>-tool-kb_search \
  --cli-binary-format raw-in-base64-out \
  --payload '{"query":"wine pairings","pipelines":["menu"]}' \
  --client-context "ewogICJjdXN0b20iOiB7ImJlZHJvY2tBZ2VudENvcmVUb29sTmFtZSI6ICJ0ZXN0X19fa2Jfc2VhcmNoIn0KfQ==" out.json
# Expected log line:
#   Retrieving from KB <id> with filter: {'equals': {'key': 'pipeline', 'value': 'menu'}} ...

# Filter by user_id + multiple pipelines -> andAll + in
# Payload: {"query":"cuisine trends","user_id":"alice","pipelines":["bistro_research","open_research"]}
# Expected filter:
#   {'andAll': [{'equals': {'key': 'user_id', 'value': 'alice'}},
#               {'in': {'key': 'pipeline', 'value': ['bistro_research','open_research']}}]}

# No filter at all (only when user_id missing AND pipelines empty)
# Expected log: "no user_id or pipelines provided, returning all docs (unfiltered)"
```

Run `python3 gateway/tools/kb_search/handler.py` locally for offline filter-shape verification (9 test cases, no AWS calls needed). Same offline smoke test exists for `gateway/tools/kb_ingest/handler.py` — it requires `KB_DOCS_BUCKET`, `KNOWLEDGE_BASE_ID`, `DATA_SOURCE_ID` env vars set to any stub value.

#### End-to-end runbook (after a stage deploy)

Confirms the logical views are actually siloed. Do each step in order; the following step depends on the previous producing the right tag.

1. **Bistro Deep Dive** → `/research`, approve the plan. Expected logs:
    - `pdf_generator: fmt=research pipeline=bistro_research user_id=yes`
    - `kb_ingest` copies the PDF with tag `pipeline=bistro_research` (check `aws s3api get-object-tagging --bucket <stack>-kb-docs-<account> --key generated/reports/...`)
2. **AI Concierge** → `/chat`, ask "what research do we have on the bistro?" Expected:
    - `kb_search` filter = `{"in": {"key": "pipeline", "value": ["menu"]}}` (plus `user_id` → `andAll`)
    - Result: no hits (the step-1 PDF is tagged `bistro_research`, outside the concierge's menu-only scope) — confirms isolation.
3. **Open Research** → `/research-studio`, approve the plan. Expected tag `pipeline=open_research` in the KB doc.
4. **Voice Avatar** → `/avatar`:
    - Default chips = All → `kb_search` filter = `{"in": {"key": "pipeline", "value": ["bistro_research", "open_research", "menu"]}}` (all three are surfaced).
    - Click chip "Menu only" → `kb_search` filter switches on the next call to `{"equals": {"key": "pipeline", "value": "menu"}}`.
    - Toggle All again → filter becomes the three-element `in` form.
5. **Report Archive** → `/archive`, ask "list every report". Expected:
    - No `pipelines` clause in the kb_search filter (only `user_id` equals, or no filter at all).
    - Result: all three pipelines' documents surface.

### Authentication

- **User → Runtime**: OIDC Authorization Code flow via Cognito. Frontend uses `react-oidc-context`.
- **Agent → Gateway**: M2M Client Credentials (OAuth2). Machine client secret in Secrets Manager. Token cached with 60s safety margin.
- **Gateway JWT**: Custom JWT authorizer validates M2M tokens via Cognito discovery URL.
- **Identity Pool**: SigV4 credentials for `bedrock-agentcore:InvokeAgent` and WebSocket streaming.

### Frontend App

React 19 + Vite 7 + TypeScript with Cloudscape Design System, Tailwind v4, Framer Motion, Zustand. Three.js for 3D avatar. ReactFlow for agent pipeline visualization.

Pages: Home, Research, Menu, Chat, Avatar. SSE streaming via `AgentCoreClient` + `useChatEngine`. Avatar uses separate WebSocket client (`AvatarWebSocketClient`).

Environment variables injected via CodeBuild at deploy time (prefixed with `VITE_`). For local dev, `npm run kit -- refresh-frontend [stage]` generates a `.env` file.

### Property Injectors (Blueprints)

Applied globally via `App({ propertyInjectors })` in `bin/app.ts`. Never duplicate these configs per-construct:

- **LogGroupInjector**: 3-month retention, DESTROY removal
- **FunctionLogGroupInjector**: Auto-creates LogGroup per Lambda
- **FunctionPlatformInjector**: ARM64 architecture, Node.js 22.x / Python 3.13 runtimes
- **BucketInjector**: Block all public access, enforce SSL, auto-delete + DESTROY removal

## Key Files

```
bin/app.ts                          # CDK entrypoint, applies property injectors
lib/stage.ts                        # ApplicationStage: 5 stacks + env var wiring
lib/common/feature-flags.ts         # Feature flags + model config from cdk.json
lib/stacks/shared.ts                # DynamoDB, S3, KB (S3 Vectors), Neptune
lib/stacks/auth.ts                  # Cognito, M2M client, WAF, Identity Pool
lib/stacks/backend/index.ts         # Gateway, Runtimes, Memory, Guardrails, Feedback API
lib/stacks/backend/agentcore-role.ts # Shared IAM role for both runtimes
lib/stacks/frontend/                # S3 + CloudFront + CodeBuild deployment
lib/common/constructs/stack.ts      # Custom Stack base class (auto projectId prefix)
lib/common/constructs/federate/     # FederateUserPool/Client (Midway support)

patterns/orchestrator-agent/        # In-process multi-agent orchestrator (6 modes)
patterns/planner-agent/             # Research plan decomposition
patterns/researcher-agent/          # KB search + web search + citations
patterns/synthesizer-agent/         # Cross-reference → executive summary
patterns/pdf-writer-agent/          # 12-section PDF generation
patterns/avatar-agent/              # BidiAgent + Nova Sonic WebSocket
patterns/utils/                     # auth.py, ssm.py, heartbeat.py, responses_api.py, tool_guard.py (UserScopeHook), pipeline_scope.py (PipelineScopeHook + MODE_PIPELINE_CONFIG)

gateway/tools/{name}/               # Lambda tool handlers (handler.py + tool_spec.json)
tools/kit.ts                        # Interactive CLI (deploy, synth, destroy, credentials)
tools/export.ts                     # @export directive processor
```

## Configuration

### cdk.json Context

- `projectId`: Resource naming prefix (< 15 chars)
- `stackNameBase`: AgentCore naming prefix (< 35 chars)
- `accounts`: Stage → `{ id, region, midway? }` mapping
- `adminUserEmail`: Auto-create Cognito admin user (null to skip)
- `features`: Feature flag object (see below)
- `models`: Model ID overrides

### Feature Flags (`features` in cdk.json)

| Flag                     | Default      | Controls                                              |
| ------------------------ | ------------ | ----------------------------------------------------- |
| `avatar`                 | true         | Avatar Runtime (Nova Sonic)                           |
| `knowledge_base`         | true         | Bedrock KB deployment                                 |
| `kb_backend`             | "s3-vectors" | KB storage backend (`s3-vectors` or `opensearch`)     |
| `neptune`                | false        | Neptune Analytics (~$8/hr)                            |
| `episodic_memory`        | true         | AgentCore episodic memory strategy                    |
| `semantic_memory`        | true         | Semantic memory strategy                              |
| `user_preference_memory` | true         | User preference memory strategy                       |
| `durable_functions`      | false        | Lambda Durable Functions (research_orchestrator tool) |
| `guardrails`             | true         | Bedrock Guardrails (chatbot mode)                     |
| `browser`                | true         | AgentCore Browser tool (3D kitchen monitor)           |
| `sample_tool`            | false        | Throwaway word-counter tool registered with Gateway   |

### Model Config (`models` in cdk.json)

| Key                    | Default                                    |
| ---------------------- | ------------------------------------------ |
| `orchestrator`         | `us.anthropic.claude-sonnet-4-6`           |
| `avatar_sonic`         | `amazon.nova-2-sonic-v1:0`                 |
| `avatar_tool_selector` | `amazon.nova-2-lite-v1:0`                  |
| `kb_embedding`         | `amazon.nova-2-multimodal-embeddings-v1:0` |

## Conventions

- **cdk-nag**: `AwsSolutionsChecks` applied to the entire stage in `lib/stage.ts`. Suppressions colocated with constructs.
- **Federate constructs**: `FederateUserPool`/`FederateUserPoolClient` in `lib/common/constructs/federate/` wrap Cognito with Midway support. Replace with standard constructs for public distribution.
- **@export directives**: `tools/export.ts` processes these to strip internal code. Do not remove `// @export` or `<!-- @export -->` comments.
- **Monorepo workspaces**: Frontend is at `lib/stacks/frontend/app`. Use `-w frontend` for frontend commands.
- **Pre-commit hooks**: Husky + lint-staged runs Prettier/ESLint on TS and ruff on Python.
- **Tests**: Jest with ts-jest, test files expected in `test/` matching `**/*.test.ts` (directory not yet created).
- **SSM for cross-stack refs**: Stacks communicate via SSM Parameter Store, not CloudFormation outputs.
- **Tool handler pattern**: `gateway/tools/{name}/handler.py` receives MCP event, returns `{"content": [{"type": "text", "text": "..."}]}`.
- **Named imports, destructuring props, intermediate constructor variables** — assign to `this.*` at end of constructor.

## Known Constraints

- **AgentCore proxy timeout**: ~80s idle timeout. Heartbeat thread (`patterns/utils/heartbeat.py`) fires every 10s to keep SSE alive during long tool calls.
- **Synthesizer timeout**: Uses `read_timeout=1800` and `thinking_budget_tokens=10000` for extended analysis.
- **Nova Sonic region**: `us-east-1` only.
- **stackNameBase max length**: 35 chars (AgentCore runtime naming constraint).
- **IAM eventual consistency**: KB creation uses a 45s CustomResource waiter for IAM policy propagation.
- **SSE anti-buffering**: Orchestrator monkey-patches Starlette's `StreamingResponse` to add `X-Accel-Buffering: no` header for AgentCore's nginx proxy.
- **M2M token caching**: Cached with 60s safety margin before expiry. Uses Secrets Manager (not SSM) for client secret.
- **Lambda cross-compilation**: Tool Lambdas with native deps use `--platform manylinux2014_aarch64 --only-binary :all:` for ARM64 bundling from macOS.
- **Cross-stack export removal**: If you remove a resource from Shared that Backend imports (via CloudFormation exports), deploy Backend first with `--exclusively` to remove the import, then deploy Shared to drop the export. Otherwise CloudFormation will fail with "Cannot delete export ... as it is in use".
