import { Node } from "constructs";

const MAX_STACK_NAME_BASE_LENGTH = 35;

export type KbBackend = "s3-vectors" | "opensearch";

export interface FeatureFlags {
    avatar: boolean;
    /**
     * LiveKit voice path. When true, deploys the self-hosted LiveKit stack
     * (VPC + ECS Fargate LiveKit server + Nova Sonic 2 agent worker + token
     * API) and the frontend connects the Relationship Manager over WebRTC
     * instead of the AgentCore avatar WebSocket. Independent of `avatar`
     * during the migration; once proven, `avatar` can be turned off.
     */
    livekit: boolean;
    /**
     * Tavus video-avatar path. When true, deploys the self-hosted Pipecat +
     * Nova Sonic worker (ECS Fargate) and its Cognito-authorized offer API, and
     * the frontend's "Realistic" avatar becomes a server-rendered Tavus video
     * track. Independent of `livekit`: it runs as a parallel transport used
     * only when the visitor selects the Tavus variant. See the
     * `tavus-avatar-integration` spec.
     */
    tavus_avatar: boolean;
    knowledge_base: boolean;
    kb_backend: KbBackend;
    neptune: boolean;
    episodic_memory: boolean;
    semantic_memory: boolean;
    user_preference_memory: boolean;
    durable_functions: boolean;
    guardrails: boolean;
    browser: boolean;
    sample_tool: boolean;
    /**
     * AgentCore Payments (preview) for the Deep Research Agent.
     *
     * When true, deploys a PaymentManager plus a SELF-HOSTED x402 merchant
     * (API Gateway + Lambda serving synthetic premium market data) so the
     * researcher can discover a paywalled data source, pay per query, and stay
     * inside a budget the user approved alongside the research plan. Keeping
     * the merchant in-stack is what lets the demo stay self-contained: no
     * external API, no real funds, deploy and destroy with plain CDK.
     *
     * Defaults to FALSE because AgentCore Payments is a preview service whose
     * APIs may change before GA, and because a live payment path needs a
     * funded (testnet) wallet the operator has to supply.
     */
    payments: boolean;
    /**
     * AgentCore Policy engine on the Gateway. When true, provisions a Cedar
     * policy engine associated with the Gateway that evaluates every tool call
     * for authorization. Ships in LOG_ONLY mode — it records allow/deny traces
     * on real traffic WITHOUT enforcing, which is the AWS-recommended way to
     * validate policies before flipping to ENFORCE (ENFORCE is default-deny, so
     * it must not be enabled until a complete permit set + per-agent identities
     * are in place). Defaults to true; set false to skip if the preview
     * PolicyEngine resource is unavailable in the target account.
     */
    policy: boolean;
    /**
     * Enforcement mode for the Policy engine: "LOG_ONLY" (default, safe) or
     * "ENFORCE". Only flip to ENFORCE after validating the LOG_ONLY traces —
     * Cedar is default-deny, so ENFORCE without complete permit policies blocks
     * every tool call.
     */
    policyMode: "LOG_ONLY" | "ENFORCE";
    /**
     * AgentCore Harness (managed agent loop). When true, provisions a small
     * customer-facing "Quick Assistant" harness via a CDK custom resource so the
     * Harness console page shows a real managed agent alongside the Runtime
     * agents. It is additive (a new external experience), not a conversion of
     * any existing agent, and has no in-app UI — it exists to demonstrate the
     * config-only managed-loop build path. Provisioning is best-effort: if the
     * preview control-plane API is unavailable in the account, the deploy still
     * succeeds and the entry simply does not appear. Defaults to true.
     */
    harness: boolean;
    /**
     * A2A fraud hop — the headline agent-to-agent capability. When true, deploys
     * the dedicated Fraud-Research Agent as its own AgentCore Runtime configured
     * with the A2A server protocol, a distinct Cognito M2M client (its own Gateway
     * principal), and a Cedar deny scoped to that principal, and wires the
     * account-opening agent (`ai_agent`) to discover the fraud agent's card and
     * call it over A2A during the KYC/fraud step — the requesting customer's
     * verified identity propagates across the hop. When false, the account-opening
     * agent runs the proven in-process path and none of the A2A fraud resources
     * are deployed, so the demo still deploys and destroys cleanly. Defaults to
     * true.
     */
    a2a: boolean;
    /**
     * Convert the parallel section researchers from in-process sub-agents to A2A
     * invocations against a section-researcher runtime. Higher-risk than the fraud
     * hop (per-call token minting, network/timeout/retry, researcher cold starts,
     * partial-failure semantics), so it is gated independently of `a2a` and
     * defaults to FALSE — the proven in-process fan-out stays the fallback until
     * this is validated in a non-demo environment.
     */
    a2a_parallel_research: boolean;
    /**
     * Bedrock Prompt Optimization showcase for the customer-facing AI Agent
     * (the "AI Client Advisor"). When true, the orchestrator accepts the
     * presenter-driven `optimize_prompt` / `optimize_sample` modes that stream
     * the Bedrock `OptimizePrompt` analysis + model-tailored optimized prompt
     * for the AI Agent's current system prompt across the supported target
     * foundation models, the shared AgentCore role is granted
     * `bedrock:OptimizePrompt`, and the frontend surfaces the Showcase_Card
     * entry point and the flow-panel node (`VITE_PROMPT_OPTIMIZATION_ENABLED`).
     * When false, the AI Agent runs exactly as it does today (the proven
     * `mode="chatbot"` path), the IAM action is not added, and the UI
     * affordances are hidden — so the demo still deploys and destroys cleanly.
     * Defaults to FALSE; enable it in `cdk.json` context to run the showcase.
     */
    prompt_optimization: boolean;
    /**
     * Custom model on Amazon SageMaker for the customer-facing AI Agent (the
     * "AI Client Advisor"). When true, the AI Agent runtime (`ai_agent`
     * profile) drives its chatbot turns against a model deployed on a SageMaker
     * inference endpoint (via the Strands `SageMakerAIModel` provider) instead
     * of Bedrock, the shared AgentCore role is granted `sagemaker:InvokeEndpoint`
     * scoped to that endpoint, and the endpoint name is injected into the
     * runtime env from the `sagemaker` context block. When false, the AI Agent
     * runs exactly as it does today on Bedrock — no SageMaker permission, no
     * env — so the demo still deploys and destroys cleanly.
     *
     * Defaults to FALSE. Note: Bedrock Guardrails and the OptimizePrompt
     * showcase operate on Bedrock invocations only, so they do not apply to the
     * SageMaker path.
     */
    sagemaker_model: boolean;
    /**
     * Multimodal Knowledge Base retrieval. When true, the KB data source parses
     * documents with a multimodal parser (BEDROCK_FOUNDATION_MODEL,
     * parsingModality=MULTIMODAL) so images embedded in ingested documents are
     * extracted, embedded (Nova Multimodal Embeddings), and stored in the KB's
     * supplemental S3 location — making them retrievable. `kb_search` then
     * surfaces retrieved IMAGE chunks as presigned image URLs, and both the AI
     * Agent chat and the avatar chat render them alongside the text answer.
     *
     * When false, the KB uses the default text-only parser and `kb_search`
     * returns text + PDF citations exactly as today.
     *
     * NOTE: the KB must already have a supplemental data storage location (it
     * does — see `supplementalDataStorageConfiguration` in shared.ts); that
     * cannot be added to an existing KB in place. Enabling this flag REPLACES
     * the KB data source (parsing strategy cannot change in place) and triggers
     * re-ingestion. Defaults to FALSE.
     */
    kb_multimodal: boolean;
    /**
     * AWS Agent Registry (preview) publishing. When true, deploys a Lambda-backed
     * CloudFormation custom resource that, at deploy, creates an AWS Agent
     * Registry (AWS_IAM discovery) and publishes APPROVED AGENT records for the
     * demo's A2A agents (the Fraud & Research agent, and — when
     * `a2a_parallel_research` is on — the Section Researcher). This is what makes
     * the otherwise-empty AWS Agent Registry console list the demo's agents.
     *
     * Provisioning is BEST-EFFORT and self-contained: the custom resource
     * tolerates already-exists / already-approved conditions, isolates per-record
     * failures, and its Delete path always succeeds so a stack delete is never
     * blocked. When false, none of the registry resources are created, so the
     * demo still deploys and destroys cleanly.
     *
     * Defaults to FALSE because the AWS Agent Registry is a preview service whose
     * control-plane APIs may change before GA (and require a boto3 newer than the
     * Lambda runtime's built-in, which the custom resource bundles).
     */
    agent_registry: boolean;
    /**
     * AgentCore Identity token acquisition for Gateway auth. When true, an
     * OAuth2 credential provider (custom resource — no CFN resource exists)
     * stores the Gateway's Cognito M2M client credentials in the AgentCore
     * Identity token vault, and agents obtain Gateway tokens through Identity
     * (GetWorkloadAccessToken → GetResourceOauth2Token) instead of calling the
     * Cognito token endpoint directly — making the Identity console (workload
     * identities, credential providers, token vault) show the demo's auth in
     * active use. The resulting bearer is the SAME Cognito JWT the Gateway
     * already accepts, and the agent code automatically falls back to the
     * direct-Cognito path on any Identity failure, so enabling this cannot
     * break tool calls. Defaults to FALSE.
     */
    agentcore_identity: boolean;
    /**
     * Managed Web Search Tool connector for the Gateway (`connectorId:
     * "web-search"`). When true, the demo's web search is served by the
     * AWS-managed Web Search Tool built-in connector — a fully managed,
     * MCP-compliant web index operated by Amazon — instead of the custom
     * Nova-grounding Lambda (`gateway/tools/web_search`). The custom Lambda and
     * its target are then NOT created. The connector is pinned to version
     * `1.2.0`, which adds a target-level domain include/exclude list plus
     * per-request domain and published-date filters the agent can apply. The
     * demo configures only a target-level EXCLUDE (deny) list — a target-level
     * include list would restrict EVERY query to those domains and break the
     * research agent's open-web research, so the regulator allow-list and date
     * bound are applied per-query by the agent instead. Queries never leave AWS.
     * Defaults to FALSE (custom Lambda path).
     */
    managed_web_search: boolean;
    /**
     * Managed Bedrock evaluation for the AI Assistant Services Catalog. When
     * true, the catalog card exposes a "Launch Bedrock evaluation" button that
     * ships the base model's descriptions and a challenger model's rewrites to
     * Amazon Bedrock's model-evaluation service as two real, console-visible
     * model-as-a-judge jobs scored against a custom rubric (the A/B lives in the
     * Bedrock console, not inline). The orchestrator accepts the
     * `catalog_evaluate` mode, the shared role is granted the evaluation actions
     * + a self-scoped `iam:PassRole`, and the frontend surfaces the button
     * (`VITE_BEDROCK_MANAGED_EVAL_ENABLED`). When false, the mode is rejected,
     * the IAM actions are not added, and the button is hidden — so the demo
     * still deploys and destroys cleanly. Defaults to FALSE.
     */
    bedrock_managed_eval: boolean;
    /**
     * AgentCore Evaluations for the AI Assistant. When true, a custom-resource
     * provisioner creates a custom LLM-as-a-judge evaluator plus an online
     * evaluation configuration that scores the AI Assistant runtime's live spans
     * (from CloudWatch `aws/spans`, filtered by service name) — populating the
     * AgentCore console's "Custom evaluators" and "Evaluation configurations"
     * tabs and feeding AgentCore Observability. This is the foundation of the
     * AgentCore evaluation/optimization/A-B story (Option B). Requires per-runtime
     * Tracing + CloudWatch Transaction Search to be enabled so spans exist.
     * Provisioning is best-effort (preview control-plane API): if unavailable,
     * the deploy still succeeds and the entries simply do not appear. Defaults to
     * FALSE.
     */
    agentcore_evaluation: boolean;
}

export interface ModelConfig {
    orchestrator: string;
    avatar_sonic: string;
    avatar_tool_selector: string;
    kb_embedding: string;
    /**
     * Foundation model used to parse documents at KB ingestion when
     * `features.kb_multimodal` is on. Must be a vision-capable, directly
     * invocable foundation-model id in the deploy region.
     */
    kb_parser: string;
}

const DEFAULT_FEATURES: FeatureFlags = {
    avatar: true,
    livekit: false,
    tavus_avatar: false,
    knowledge_base: true,
    kb_backend: "s3-vectors",
    neptune: false,
    episodic_memory: true,
    semantic_memory: true,
    user_preference_memory: true,
    durable_functions: false,
    guardrails: true,
    browser: true,
    sample_tool: false,
    payments: false,
    policy: true,
    policyMode: "LOG_ONLY",
    harness: true,
    a2a: true,
    a2a_parallel_research: false,
    prompt_optimization: false,
    sagemaker_model: false,
    kb_multimodal: false,
    agent_registry: false,
    agentcore_identity: false,
    managed_web_search: false,
    bedrock_managed_eval: false,
    agentcore_evaluation: false,
};

const DEFAULT_MODELS: ModelConfig = {
    orchestrator: "us.anthropic.claude-sonnet-4-6",
    avatar_sonic: "amazon.nova-2-sonic-v1:0",
    avatar_tool_selector: "amazon.nova-2-lite-v1:0",
    kb_embedding: "amazon.nova-2-multimodal-embeddings-v1:0",
    // Nova Lite: vision-capable, directly invocable in us-east-1, and NOT
    // legacy-gated. Claude 3 Haiku was marked Legacy and the KB role was denied
    // ("not actively using in the last 30 days"), which failed every ingestion.
    kb_parser: "amazon.nova-lite-v1:0",
};

export function getFeatureFlags(node: Node): FeatureFlags {
    const features = node.tryGetContext("features") ?? {};
    return { ...DEFAULT_FEATURES, ...features };
}

export function getModelConfig(node: Node): ModelConfig {
    const models = node.tryGetContext("models") ?? {};
    return { ...DEFAULT_MODELS, ...models };
}

export interface TavusConfig {
    workerCpu: number;
    workerMemory: number;
    /**
     * Nova Sonic voice for the worker, fixed for the life of the Fargate task
     * (same limitation as the LiveKit worker — the offer carries no voice).
     * Must be one of the ids in the frontend's voice-config.ts VOICES.
     */
    novaSonicVoiceId: string;
    /**
     * Optional Tavus persona id passed to TavusVideoService. The replica id and
     * API key are NOT here — they live only in Secrets Manager.
     */
    personaId?: string;
    /**
     * Nova Sonic voice id → Tavus replica id. Lets the caller's chosen voice
     * pick a matching avatar face (female `tiffany` → Gloria, male `matthew` →
     * Raj). Replica ids are non-sensitive Tavus resource identifiers, so they
     * live here rather than in the secret; the worker still falls back to the
     * secret's single `TAVUS_REPLICA_ID` for any voice not listed.
     */
    replicaByVoice?: Record<string, string>;
}

const DEFAULT_TAVUS_CONFIG: TavusConfig = {
    workerCpu: 1024,
    workerMemory: 2048,
    novaSonicVoiceId: "tiffany",
    personaId: "pipecat-stream",
    replicaByVoice: {
        tiffany: "r3f427f43c9d",
        matthew: "rf8f3aa4b33e",
    },
};

export function getTavusConfig(node: Node): TavusConfig {
    const tavus = node.tryGetContext("tavus") ?? {};
    return { ...DEFAULT_TAVUS_CONFIG, ...tavus };
}

export interface SageMakerConfig {
    /**
     * SageMaker inference endpoint the AI Agent invokes when
     * `features.sagemaker_model` is on. Accepts either the bare endpoint NAME or
     * a full endpoint ARN (`arn:aws:sagemaker:<region>:<acct>:endpoint/<name>`);
     * `getSageMakerConfig` normalizes an ARN down to the name. PLACEHOLDER by
     * default — point it at a real deployed endpoint before enabling the flag.
     * The IAM grant is scoped to this endpoint.
     */
    endpointName: string;
    /**
     * Region the endpoint is deployed in. Defaults to the stack/deploy region
     * when left empty (the runtime falls back to its own AWS_REGION).
     */
    regionName: string;
    /**
     * Inference component to target on the endpoint. REQUIRED for
     * inference-component endpoints (e.g. a base model + LoRA adapters served
     * as components) — plain InvokeEndpoint fails without it. Leave empty for a
     * classic single-model endpoint. The IAM grant is widened to the
     * inference-component resource when this is set.
     */
    inferenceComponentName: string;
    /** Max output tokens for the SageMaker chat completion. */
    maxTokens: number;
}

const DEFAULT_SAGEMAKER_CONFIG: SageMakerConfig = {
    endpointName: "PLACEHOLDER-ai-agent-sagemaker-endpoint",
    regionName: "",
    inferenceComponentName: "",
    maxTokens: 4096,
};

export function getSageMakerConfig(node: Node): SageMakerConfig {
    const sagemaker = node.tryGetContext("sagemaker") ?? {};
    const merged: SageMakerConfig = { ...DEFAULT_SAGEMAKER_CONFIG, ...sagemaker };
    // Accept either a bare endpoint name or a full endpoint ARN in
    // `endpointName`. Both the IAM grant (scoped as
    // `arn:aws:sagemaker:<region>:<acct>:endpoint/<name>`) and the runtime's
    // `invoke_endpoint` call need the bare NAME, so normalize an ARN
    // (arn:aws:sagemaker:<region>:<acct>:endpoint/<name>) down to its final
    // path segment. When a region wasn't set explicitly, derive it from the ARN
    // so the runtime targets the endpoint's actual region.
    const raw = String(merged.endpointName || "");
    if (raw.startsWith("arn:")) {
        merged.endpointName = raw.split("/").pop() || raw;
        const parts = raw.split(":");
        if (!merged.regionName && parts.length > 3 && parts[3]) {
            merged.regionName = parts[3];
        }
    }
    return merged;
}

export function getStackNameBase(node: Node): string {
    const stackNameBase = node.tryGetContext("stackNameBase");
    if (!stackNameBase) {
        throw new Error("stackNameBase is required in cdk.json context");
    }
    if (stackNameBase.length > MAX_STACK_NAME_BASE_LENGTH) {
        throw new Error(
            `stackNameBase '${stackNameBase}' is too long (${stackNameBase.length} chars). ` +
                `Maximum length is ${MAX_STACK_NAME_BASE_LENGTH} characters due to AWS AgentCore runtime naming constraints.`
        );
    }
    return stackNameBase;
}

export function getAdminUserEmail(node: Node): string | null {
    return node.tryGetContext("adminUserEmail") ?? null;
}
