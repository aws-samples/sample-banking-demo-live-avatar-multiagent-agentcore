import { Node } from "constructs";

const MAX_STACK_NAME_BASE_LENGTH = 35;

export type KbBackend = "s3-vectors" | "opensearch";

export interface FeatureFlags {
    avatar: boolean;
    knowledge_base: boolean;
    kb_backend: KbBackend;
    neptune: boolean;
    episodic_memory: boolean;
    semantic_memory: boolean;
    user_preference_memory: boolean;
    agentcore_policy: boolean;
    agentcore_evaluations: boolean;
    server_side_tools: boolean;
    durable_functions: boolean;
    guardrails: boolean;
}

export interface ModelConfig {
    orchestrator: string;
    avatar_sonic: string;
    avatar_tool_selector: string;
    kb_embedding: string;
}

const DEFAULT_FEATURES: FeatureFlags = {
    avatar: true,
    knowledge_base: true,
    kb_backend: "s3-vectors",
    neptune: false,
    episodic_memory: true,
    semantic_memory: true,
    user_preference_memory: true,
    agentcore_policy: false,
    agentcore_evaluations: false,
    server_side_tools: true,
    durable_functions: false,
    guardrails: true,
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
