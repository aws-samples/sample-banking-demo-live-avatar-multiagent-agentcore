# Multi-agent banking demo with a live avatar, built on Amazon Bedrock AgentCore

A multi-agent research platform built on **Amazon Bedrock AgentCore** that produces
comprehensive PDF research reports through a human-in-the-loop pipeline, plus an
AI services-catalog designer, a guardrailed concierge chat with a live browser
sub-agent, and a real-time voice avatar. It deploys entirely with the AWS CDK and
costs ~$0 when idle (fully pay-per-use).

This is the **customer MVP build**: a trimmed, self-contained version of the
internal demo that a team outside AWS can deploy into their own account with
plain CDK. Third-party voice paths, preview-only services, and internal Amazon
tooling have been removed or disabled (see [What's in this MVP](#whats-in-this-mvp)).

---

## Overview

### The scenario

Trinity Reserve Bank is a **fictional, proposed bank**, not an operating one. The
demo opens from a founder's brief and works it up into a business: research the
market, design the client services catalog, stand up a customer onboarding agent,
and put a live advisor in front of customers. Every document, rate, price, and
product image is synthetic or model-generated. Nothing here is real customer data,
and nothing here is financial advice.

### What it is actually demonstrating

Getting an agent from prototype to production takes far more than a model call. A
real agentic application needs multi-agent orchestration, tool integration,
persistent memory, guardrails, grounded retrieval, live web action, code execution,
identity, and observability. Assembling that yourself means gluing frameworks
together, running and securing servers, managing sessions and auth, and paying for
idle capacity.

This application builds the same feature set out of **managed AgentCore
primitives**, so each moving part maps to a service you do not have to operate.
The point of the demo is less "look at the bank" and more "look at how little
plumbing is left".

### The four experiences

All four run from a **single orchestrator container image**, deployed as separate
AgentCore Runtimes that differ only by an `AGENT_PROFILE` environment variable.
Adding an experience does not mean adding a service to operate.

| Experience               | Audience           | What it shows                                                                                                                                                                                    |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Deep Research Agent**  | Internal employees | Planner, Researcher, Synthesizer and PDF Writer running in one Runtime, pausing for human approval of the plan, then emitting a cited 12-section PDF that an LLM-as-a-judge evaluator scores.    |
| **AI Assistant**         | Internal employees | Turns the strategy report into the client services catalog: retrieval grounded in the knowledge base, Nova Canvas product imagery, then deterministic quality control before anything ships.     |
| **AI Agent**             | External customers | A guardrailed onboarding and KYC concierge. Bedrock Guardrails refuse off-topic and sensitive asks, and an AgentCore Browser microVM is driven live on screen when a real web session is needed. |
| **Avatar/Digital Human** | External customers | Real-time speech-to-speech advisory over Amazon Nova Sonic with selectable personas and languages, plus an optional photoreal video avatar.                                                      |

A flow sidebar lights up each AgentCore component as it is invoked, so the
primitives stay visible while the agents work instead of being buried in logs.

### What to take away

- **Composable managed primitives.** Runtime, Gateway (MCP tools), Memory,
  Identity, Browser, Code Interpreter, Policy, Evaluations and Observability are
  wired together rather than hand-built.
- **Grounded retrieval with tenant isolation.** One Bedrock Knowledge Base on S3
  Vectors is split into logical views, with per-user and per-pipeline filters
  enforced server-side, so one user's generated reports never surface for another.
- **Enterprise defaults from the start.** Cognito OIDC for users,
  machine-to-machine OAuth2 for agent-to-Gateway calls, WAF on the entry points,
  and managed encryption.
- **Infrastructure as code, and reversible.** Five CDK stacks (six with the
  optional Tavus video avatar) stand the whole thing up and tear it back down with
  standard commands.
- **Pay-per-use.** Scale-to-zero throughout, so an idle deployment costs roughly
  nothing.

---

## What's in this MVP

**Application experiences:**

- **Multi-agent research pipeline** — Planner → Researcher → Synthesizer → PDF
  Writer, with human-in-the-loop plan approval, producing a 12-section PDF report.
- **AI menu/catalog designer** with Nova Canvas dish imagery and PDF export.
- **Guardrailed concierge chat** with an in-process AgentCore Browser sub-agent
  (live view) and AgentCore Code Interpreter.
- **Voice avatar** — real-time speech-to-speech via Amazon Nova Sonic (AWS-native,
  no third party required).
- **"Realistic" video avatar (Tavus)** — optional; **requires a purchased Tavus
  key** (see [Optional: enable the Tavus video avatar](#optional-enable-the-tavus-video-avatar)).

**AgentCore services exercised by this build** (all generally available):

| Service              | How the demo uses it                                                              |
| -------------------- | --------------------------------------------------------------------------------- |
| **Runtime**          | Orchestrator (HTTP/SSE), Avatar (WebSocket), and A2A fraud-research runtimes      |
| **Gateway**          | MCP protocol fronting the Lambda-backed tools                                     |
| **Memory**           | Episodic, semantic, and user-preference strategies                                |
| **Identity**         | Gateway tokens minted via the Identity token vault (falls back to direct Cognito) |
| **Browser**          | Chromium microVM driven by Playwright/CDP with live view in chat                  |
| **Code Interpreter** | Sandboxed Python for PDF image extraction                                         |
| **Observability**    | OpenTelemetry traces and logs to CloudWatch                                       |
| **Policy**           | Cedar policy engine on the Gateway, in `LOG_ONLY` mode                            |
| **Evaluations**      | Custom LLM-as-a-judge evaluator, used by on-demand batch evaluation               |
| **Harness**          | Config-only managed agent loop ("Quick Assistant")                                |

Alongside these: **Bedrock Knowledge Base** on S3 Vectors, **Bedrock Guardrails**,
**Bedrock model evaluation**, **Bedrock prompt optimization**, and an **A2A**
agent-to-agent fraud/KYC hop.

> **Policy is intentionally `LOG_ONLY`.** It records allow/deny decisions on real
> traffic without blocking, which is the recommended way to validate Cedar
> policies first. Cedar is default-deny, so do not switch `policyMode` to
> `ENFORCE` until you have a complete permit set for every tool.

**Removed or left off for the MVP** (relative to the internal demo):

| Item                                                  | Status  | Why                                                                                                                                 |
| ----------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| LiveKit voice path                                    | Removed | Third-party + always-on Fargate cost; the native Nova Sonic avatar covers voice.                                                    |
| SageMaker custom model                                | Off     | Requires a customer-supplied inference endpoint.                                                                                    |
| Neptune Analytics                                     | Off     | Always-on (~$8/hr).                                                                                                                 |
| AgentCore Payments                                    | Off     | GA, but needs a funded (testnet) wallet you must supply.                                                                            |
| AWS Agent Registry                                    | Off     | Not available in every AgentCore region and access is gated; would deploy an empty registry.                                        |
| Managed Web Search connector                          | Off     | The custom Nova-grounded `web_search` tool is used instead; switching changes the registered tool name the agent prompts reference. |
| Parallel A2A research fan-out                         | Off     | The proven in-process fan-out is more reliable (no per-call token minting or partial-failure handling).                             |
| Durable functions, multimodal KB parsing, sample tool | Off     | Not needed for the MVP path.                                                                                                        |

Everything above is a feature flag in [`cdk.json`](cdk.json); items that are off
create no resources. Turn any of them on there.

### AgentCore Runtime platform version (V1 vs V2)

This demo's runtimes currently run on **AgentCore Runtime platform version V1**,
which is the service default.

AWS [announced the next-generation AgentCore Runtime on 18 September 2026](https://aws.amazon.com/about-aws/whats-new/2026/09/new-agentcore-runtime-generally-available/).
Opted into per-runtime with `platformVersion: "V2"`, it starts each instance by
restoring a prepared snapshot instead of initializing the environment every time.
That gives consistent cold starts regardless of image size (AWS reports a P75 of
1.9–2.0s for 200 MB–2 GB images, versus 5.4–30s on V1) and elastic memory that is
reclaimed during a session, so you pay for actual usage rather than the peak. V2
is available in `us-east-1`, `us-east-2`, `us-west-2`, `eu-west-1`, and
`ap-northeast-1`.

V2 is attractive for this application — the orchestrator image is ~1.5 GB, right
in the band where V1 cold starts are slowest — but it is **not enabled here yet**,
for three reasons:

1. **No infrastructure-as-code support.** Per the
   [platform versions documentation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-how-it-works.html#runtime-platform-versions),
   CloudFormation and the AWS CDK cannot set `platformVersion` today, and
   `CfnRuntime` (aws-cdk-lib 2.253.1) exposes no such property. Every runtime here
   is deployed as `AWS::BedrockAgentCore::Runtime`, so enabling V2 would require an
   out-of-band `update-agent-runtime` call rather than a one-line CDK change.
2. **Snapshot-safe cryptography.** V2 requires crypto libraries that reseed after
   a restore; the documentation names `openssl-snapsafe-libs` on Amazon Linux 2023.
   The agent containers here are Debian (`uv:python3.13-bookworm-slim`), so moving
   to V2 means revisiting the base image first.
3. **Startup contract.** V2 snapshots on the first healthy `/ping` and requires
   initialization to finish within 120 seconds, and anything computed at startup is
   shared by every restored instance. Adopting it warrants an audit against the
   [V2 optimization guidance](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-v2-optimize.html)
   (per-request identifiers, timestamps, and credentials must not be captured in
   the snapshot).

One constraint that is **not** a blocker: V2 caps container environment variables
at 2.5 KB (versus 4 KB on V1), and the largest runtime in this stack is ~1.2 KB.

---

## Architecture

```mermaid
graph LR
    User((User))

    subgraph "Frontend — CloudFront + S3"
        UI[React 19 + Vite 7<br/>Cloudscape Design System]
    end

    subgraph "Amazon Bedrock AgentCore"
        OR[Orchestrator Runtime<br/>HTTP/SSE — Claude Sonnet]
        AV[Avatar Runtime<br/>WebSocket — Nova Sonic]
        FR[Fraud Research Runtime<br/>A2A]
        GW[Gateway — MCP tools]
        POL[Policy — Cedar<br/>LOG_ONLY]
        MEM[Memory]
        ID[Identity — token vault]
        BR[Browser microVM]
        CI[Code Interpreter]
        EV[Evaluations + Observability]
        HN[Harness]
    end

    subgraph "AWS Services"
        COG[Cognito<br/>User Pool + M2M]
        KB[Bedrock Knowledge Base<br/>S3 Vectors]
        S3[S3 Buckets]
        DDB[DynamoDB]
        LAM[Lambda — ARM64]
    end

    User --> UI
    UI -->|OIDC| OR
    UI -->|OIDC| AV
    OR -->|M2M OAuth2| GW
    ID -.->|mints Gateway token| OR
    GW --> POL
    GW --> LAM --> KB & S3 & DDB
    OR --> MEM & GR & BR
    OR -->|A2A| FR
    GW -.-> CI
    OR -.-> EV
```

The application deploys as CDK stacks (stack names are prefixed with the
`projectId` from `cdk.json`, e.g. `dev/appdev-demo-Backend`):

| Stack                  | Contents                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Frontend**           | S3 + CloudFront (OAC) + WAF (CloudFront scope)                                                                                                                     |
| **Auth**               | Cognito User Pool / Client / Identity Pool + M2M OAuth2 + WAF (Regional)                                                                                           |
| **Shared**             | DynamoDB (3 tables) + S3 (4 buckets) + Knowledge Base (S3 Vectors)                                                                                                 |
| **Backend**            | AgentCore Gateway (MCP tools) + Orchestrator, Avatar & A2A fraud Runtimes + Memory + Identity + Policy (Cedar) + Evaluations + Harness + Guardrails + Feedback API |
| **TavusAvatar**        | ECS Fargate Pipecat worker + Cognito-authorized offer API (optional — needs a Tavus key)                                                                           |
| **FrontendDeployment** | CodeBuild builds the React app in-cloud and deploys it to S3                                                                                                       |

---

## Prerequisites

- **Node.js 22.8.0** (a `.nvmrc`/Volta pin is provided; any 22.x works)
- **Python 3.11+** and [**uv**](https://docs.astral.sh/uv/getting-started/installation/)
  (the install step creates a virtualenv and installs the agent/Lambda deps)
- **Docker** with **ARM64 (linux/arm64) build support** — CDK builds the Lambda
  bundles and the AgentCore runtime / Fargate container images locally at deploy
  time. On Apple Silicon this works out of the box; on x86 hosts enable
  `binfmt`/buildx emulation.
- **AWS CLI v2** configured with credentials for the target account
  (`aws configure` or `AWS_PROFILE`)
- **Region:** `us-east-1` — Amazon Nova Sonic (the voice avatar) is only
  available there.
- Access to the required Bedrock models must be **enabled in the account**
  (Bedrock console → Model access): Claude Sonnet, Nova Sonic, Nova Lite, Nova
  Canvas, and Nova Multimodal Embeddings.
- **For AgentCore Evaluations:** enable **CloudWatch Transaction Search** in the
  deploy account. This is a one-time, account-level setting that creates the shared
  `aws/spans` log group the batch evaluation reads. Without it the evaluator still
  deploys, but launching a batch evaluation fails with
  `ValidationException: Log group 'aws/spans' not found in your account`. The rest
  of the application is unaffected.

    Enable it in the console under **CloudWatch → Application Signals (APM) →
    Transaction search → Enable Transaction Search** (tick _ingest spans as
    structured logs_), or from the CLI:

    ```bash
    # 1. Let X-Ray deliver spans into CloudWatch Logs
    ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    REGION=us-east-1
    aws logs put-resource-policy \
      --policy-name TransactionSearchXRayAccess \
      --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"TransactionSearchXRayAccess\",\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"xray.amazonaws.com\"},\"Action\":\"logs:PutLogEvents\",\"Resource\":[\"arn:aws:logs:$REGION:$ACCOUNT:log-group:aws/spans:*\",\"arn:aws:logs:$REGION:$ACCOUNT:log-group:/aws/application-signals/data:*\"],\"Condition\":{\"ArnLike\":{\"aws:SourceArn\":\"arn:aws:xray:$REGION:$ACCOUNT:*\"},\"StringEquals\":{\"aws:SourceAccount\":\"$ACCOUNT\"}}}]}"

    # 2. Send trace segments to CloudWatch Logs
    aws xray update-trace-segment-destination --destination CloudWatchLogs --region $REGION

    # 3. (Optional) indexing percentage; 1% is the free tier
    aws xray update-indexing-rule --name Default \
      --rule '{"Probabilistic":{"DesiredSamplingPercentage":1}}' --region $REGION
    ```

    Then run a catalog flow once so the agent emits spans before launching an
    evaluation.

---

## Deploy

```bash
# 1. Install dependencies (CDK + frontend workspace + Python venv via uv)
npm install

# 2. One-time per account/region: bootstrap CDK
npm run cdk -- bootstrap

# 3. Deploy everything
npm run cdk -- deploy "*/**" -c stage=dev
```

That's it — no config file editing is required. By default the account and region
come from your active AWS credentials (`CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`,
falling back to `us-east-1`). To pin a specific account/region instead, set them
in [`cdk.json`](cdk.json) under `context.accounts.dev`.

**How the "runtime executable" is packaged:** this is a serverless application, so
there are no Helm charts or standalone container images to ship separately. `cdk
deploy` compiles the source and packages every runtime component into its
deployable form automatically — Python Lambda tools are bundled to zip artifacts,
and the AgentCore runtimes and the Tavus Fargate worker are built as **Docker
images pushed to Amazon ECR**. The build (deliverable "compile source → executable")
and the deploy are the single `cdk deploy` step above.

### Access the app

1. When the deploy finishes, open the **CloudFront URL** — find it in the
   `FrontendDeployment` (or `Frontend`) stack outputs, or in the CloudFormation
   console.
2. **Create Account** on the login screen and verify your email (self sign-up is
   enabled).
3. Sign in and use the app: Home → Research → Menu → Chat → Avatar.

---

## Optional: enable the Tavus video avatar

The **"Realistic"** photoreal avatar option is rendered by [Tavus](https://tavus.io)
(which uses [Daily](https://daily.co) for WebRTC transport). Both are third-party
services billed **outside AWS, per minute of avatar usage** — you must **purchase a
Tavus plan and obtain API keys** to use this option.

> The rest of the application — including the AWS-native Nova Sonic voice avatar —
> works without Tavus. If you do not provide keys, the Tavus worker simply idles
> and the "Realistic" picker entry stays inactive; nothing else is affected.

The Tavus/Daily credentials live only in **AWS Secrets Manager** and never reach
the browser. The stack **imports** the secret by name rather than creating it, so
create and populate it (in the deploy region) either before or after deploy:

```bash
aws secretsmanager create-secret \
  --name /appdev-demo-2026/tavus \
  --region us-east-1 \
  --secret-string '{
    "TAVUS_API_KEY":"<your-tavus-api-key>",
    "TAVUS_REPLICA_ID":"<your-tavus-replica-id>",
    "TAVUS_PERSONA_ID":"pipecat-stream",
    "DAILY_API_KEY":"<your-daily-api-key>"
  }'
```

If the secret already exists, update it with `aws secretsmanager put-secret-value
--secret-id /appdev-demo-2026/tavus --secret-string '{...}'`. The worker reads it
at startup, so restart the `appdev-demo-2026-tavus-worker` ECS service (or redeploy)
after populating it. The secret name uses the `stackNameBase` from `cdk.json`
(`appdev-demo-2026` by default).

To skip Tavus entirely, set `"tavus_avatar": false` in `cdk.json` before deploying;
the native Nova Sonic avatar remains available.

---

## Cost profile

Fully pay-per-use — **~$0/month at idle**. You pay per Bedrock token, per
AgentCore invocation/microVM-minute, per Lambda invocation, and for S3 storage +
CloudFront traffic. Notable line items:

| Component                                                          | Cost                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| AgentCore Runtimes / Gateway / Memory / Browser / Code Interpreter | Per-use; $0 idle                                                 |
| AgentCore Identity                                                 | Per token/API-key request (no charge via Runtime or Gateway)     |
| AgentCore Policy / Harness                                         | No separate charge; you pay the underlying Gateway + Runtime use |
| AgentCore Evaluations                                              | Per evaluation (LLM-as-a-judge model usage)                      |
| Lambda (ARM64 tool functions)                                      | Per-invocation; $0 idle                                          |
| Cognito                                                            | Free tier (50 users)                                             |
| DynamoDB (on-demand), S3, Knowledge Base (S3 Vectors)              | Storage + per-request                                            |
| CloudFront + S3 hosting                                            | Per-request + bandwidth                                          |
| Bedrock models + Guardrails                                        | Per-token / per-assessment                                       |
| **Tavus Fargate worker** (only if `tavus_avatar` on)               | One always-on ARM64 task                                         |
| **Tavus + Daily** (third-party)                                    | Per-minute, billed outside AWS                                   |

See the [AWS Pricing Calculator](https://calculator.aws/#/) for estimates.

---

## Troubleshooting the deploy

**`SignatureDoesNotMatch: Signature expired`, or the CLI reports a stack failed
while the console shows it succeeded.** The CDK CLI polls CloudFormation while it
waits; if one of those requests stalls past the 5-minute SigV4 signature window
(flaky network or VPN), the CLI aborts even though CloudFormation carries on
server-side. Check the real state before assuming failure:

```bash
aws cloudformation list-stacks --region us-east-1 \
  --query "StackSummaries[?contains(StackName,'appdev')].[StackName,StackStatus]" --output text
```

Then re-run the same `cdk deploy` — it is idempotent and resumes from where it
stopped. Also confirm the machine's clock is accurate (a skew over 5 minutes
causes the same error on every request); container and VM clocks drift after the
host sleeps.

**A stack is stuck in `ROLLBACK_FAILED` mentioning `AgentMemory`.** AgentCore
Memory takes several minutes to create and cannot be deleted while it is still in
the `CREATING` state, so if something else in the Backend stack fails during that
window the automatic rollback cannot finish. Wait for the memory to finish
creating, then delete the failed stack and deploy again:

```bash
aws cloudformation delete-stack --region us-east-1 --stack-name dev-appdev-demo-Backend
aws cloudformation wait stack-delete-complete --region us-east-1 --stack-name dev-appdev-demo-Backend
npm run cdk -- deploy "*/**" -c stage=dev
```

A stack whose _initial_ create failed must be deleted rather than updated — that
is CloudFormation behaviour, not a problem with this app. To avoid the wedged
rollback entirely on a first deploy, you can add `--no-rollback` so failed
resources are left in place for inspection instead of being torn down.

**API Gateway logging.** The Auth stack sets the account/region-level API Gateway
CloudWatch Logs role, which API Gateway requires before any stage can enable
logging. Note this is an **account-wide** setting: if you already have one
configured, deploying overwrites it with an equivalent role, and destroying the
Auth stack clears it.

## Clean-up

```bash
npm run cdk -- destroy "*/**" -c stage=dev
```

A few resources may need manual deletion afterward (they are retained or not
owned by the stacks): the WAF web ACLs, any S3 buckets that still contain
objects, and — if you created it — the `/appdev-demo-2026/tavus` Secrets Manager
secret.

---

## Configuration reference

All configuration lives in [`cdk.json`](cdk.json) `context`:

- `projectId` — resource-name prefix (< 15 chars).
- `stackNameBase` — AgentCore naming prefix (< 35 chars); also the Secrets
  Manager/SSM path prefix.
- `accounts.{stage}` — `{ id, region }`; leave `id: null` to use the deployer's
  default account.
- `features` — feature flags (see [What's in this MVP](#whats-in-this-mvp)).
- `models` — Bedrock model ID overrides.

## Development

```bash
npm run build    # TypeScript compile (tsc)
npm run lint     # ESLint + ruff
npm run format   # Prettier + ruff format
npm run test     # Jest CDK tests
```

For local frontend work, run `npm run -w frontend dev` (Vite on :3000) after
creating a `.env` in the frontend workspace from the deployed stack outputs
(`VITE_*` values). The deployed app is built and hosted in-cloud by the
`FrontendDeployment` stack, so this is only needed for UI development.

## License

[Apache License Version 2.0](LICENSE)
