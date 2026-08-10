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
}

export interface ModelConfig {
    orchestrator: string;
    avatar_sonic: string;
    avatar_tool_selector: string;
    kb_embedding: string;
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
};

const DEFAULT_MODELS: ModelConfig = {
    orchestrator: "us.anthropic.claude-sonnet-4-6",
    avatar_sonic: "amazon.nova-2-sonic-v1:0",
    avatar_tool_selector: "amazon.nova-2-lite-v1:0",
    kb_embedding: "amazon.nova-2-multimodal-embeddings-v1:0",
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
