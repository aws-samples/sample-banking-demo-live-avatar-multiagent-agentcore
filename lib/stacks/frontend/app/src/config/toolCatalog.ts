/**
 * Tool → AWS service catalog.
 *
 * Single source of truth for "which AWS services does this tool actually call".
 * The flow diagrams on every page use it to show, per agent step, the services
 * being exercised — turning an abstract agent graph into a visible map of the
 * platform underneath.
 *
 * Tool labels and descriptions are NOT duplicated here: they are imported from
 * the existing TOOL_META so prose lives in exactly one place. This module adds
 * only the structured service attribution.
 */

import { TOOL_META } from "@/components/concierge-flow/flow-types";

/** A service badge: short label for chips, full name for the detail panel. */
export interface ServiceMeta {
    /** Compact label shown on a chip. */
    short: string;
    /** Full AWS service name. */
    name: string;
    /** Chip accent. Grouped by plane so the palette reads as a legend. */
    color: string;
    /** Optional AgentCore icon from /agent-icons. */
    icon?: string;
}

/**
 * Palette is grouped by plane rather than per-service so a glance at the chips
 * tells you which layer is active:
 *   teal   = AgentCore primitives
 *   purple = Bedrock models
 *   orange = data plane (S3 / DynamoDB / vectors)
 *   pink   = compute (Lambda)
 */
export const SERVICE_META: Record<string, ServiceMeta> = {
    agentcore_runtime: {
        short: "Runtime",
        name: "Bedrock AgentCore Runtime",
        color: "#01A88D",
        icon: "/agent-icons/Runtime.svg",
    },
    agentcore_gateway: {
        short: "Gateway",
        name: "Bedrock AgentCore Gateway (MCP)",
        color: "#01A88D",
        icon: "/agent-icons/Gateway.svg",
    },
    agentcore_memory: {
        short: "Memory",
        name: "Bedrock AgentCore Memory",
        color: "#01A88D",
        icon: "/agent-icons/Memory.svg",
    },
    agentcore_browser: {
        short: "Browser",
        name: "Bedrock AgentCore Browser (microVM)",
        color: "#01A88D",
        icon: "/agent-icons/Browser_Tool.svg",
    },
    agentcore_code_interpreter: {
        short: "Code Interpreter",
        name: "Bedrock AgentCore Code Interpreter",
        color: "#01A88D",
        icon: "/agent-icons/Code_Interpreter.svg",
    },
    agentcore_guardrails: {
        short: "Guardrails",
        name: "Bedrock Guardrails",
        color: "#01A88D",
        icon: "/agent-icons/Policy_Engine_Agentic_Guardrails.svg",
    },
    agentcore_payments: {
        short: "Payments",
        name: "Bedrock AgentCore Payments (preview)",
        color: "#01A88D",
        icon: "/agent-icons/Identity.svg",
    },
    bedrock_claude: {
        short: "Claude",
        name: "Amazon Bedrock — Anthropic Claude",
        color: "#8B5CF6",
    },
    bedrock_nova: {
        short: "Nova",
        name: "Amazon Bedrock — Amazon Nova",
        color: "#8B5CF6",
    },
    bedrock_stability: {
        short: "Stability",
        name: "Amazon Bedrock — Stability AI (SD3.5)",
        color: "#8B5CF6",
    },
    bedrock_kb: {
        short: "Knowledge Base",
        name: "Amazon Bedrock Knowledge Bases",
        color: "#F97316",
    },
    s3_vectors: {
        short: "S3 Vectors",
        name: "Amazon S3 Vectors",
        color: "#F97316",
    },
    s3: {
        short: "S3",
        name: "Amazon S3",
        color: "#F97316",
    },
    dynamodb: {
        short: "DynamoDB",
        name: "Amazon DynamoDB",
        color: "#F97316",
    },
    lambda: {
        short: "Lambda",
        name: "AWS Lambda",
        color: "#EC4899",
    },
    api_gateway: {
        short: "API Gateway",
        name: "Amazon API Gateway",
        color: "#EC4899",
    },
};

/**
 * Tool → the services it calls, in call order.
 *
 * Every Gateway tool runs on Lambda behind the MCP Gateway, so `lambda` and
 * `agentcore_gateway` are implied for gateway tools and listed explicitly only
 * where that is the interesting part of the story.
 */
export const TOOL_SERVICES: Record<string, string[]> = {
    kb_search: ["agentcore_gateway", "lambda", "bedrock_kb", "s3_vectors", "bedrock_nova"],
    web_search: ["agentcore_gateway", "lambda", "bedrock_nova"],
    pdf_generator: ["agentcore_gateway", "lambda", "s3", "dynamodb"],
    image_generate: ["agentcore_gateway", "lambda", "bedrock_stability", "s3"],
    image_history: ["agentcore_gateway", "lambda", "s3"],
    recall_memories: ["agentcore_gateway", "lambda", "agentcore_memory"],
    analyze_patterns: ["agentcore_gateway", "lambda", "agentcore_memory"],
    retrieve_user_profile: ["agentcore_gateway", "lambda", "dynamodb"],
    open_account: ["agentcore_gateway", "lambda", "dynamodb"],
    data_sources: ["agentcore_gateway", "lambda"],
    extract_pdf_images: ["agentcore_gateway", "lambda", "agentcore_code_interpreter", "s3"],
    website_generator: ["agentcore_gateway", "lambda", "s3"],
    browser_start: ["agentcore_browser"],
    browser_navigate: ["agentcore_browser"],
    browser_click: ["agentcore_browser"],
    browser_type: ["agentcore_browser"],
    browser_get_text: ["agentcore_browser"],
    browser_press_key: ["agentcore_browser"],
    browser_stop: ["agentcore_browser"],
    // The payments plugin's own HTTP tool. Paying for a paywalled dataset walks
    // AgentCore Payments → the merchant behind API Gateway + Lambda.
    http_request: ["agentcore_payments", "api_gateway", "lambda"],
};

export interface ToolCatalogEntry {
    key: string;
    label: string;
    description: string;
    icon?: string;
    services: ServiceMeta[];
}

/**
 * Resolve a tool key to its display metadata plus AWS services.
 *
 * Unknown tools resolve to a readable fallback rather than throwing: new
 * backend tools should degrade to a titleized name, never blank a diagram.
 */
export function describeTool(toolKey: string): ToolCatalogEntry {
    const meta = TOOL_META[toolKey];
    const serviceKeys = TOOL_SERVICES[toolKey] ?? [];
    return {
        key: toolKey,
        label: meta?.label ?? titleize(toolKey),
        description: meta?.description ?? "No description recorded for this tool yet.",
        icon: meta?.icon,
        services: serviceKeys
            .map((k) => SERVICE_META[k])
            .filter((s): s is ServiceMeta => Boolean(s)),
    };
}

/** Distinct services across a set of tools, preserving first-seen order. */
export function servicesForTools(toolKeys: string[]): ServiceMeta[] {
    const seen = new Set<string>();
    const out: ServiceMeta[] = [];
    for (const tool of toolKeys) {
        for (const key of TOOL_SERVICES[tool] ?? []) {
            if (seen.has(key)) continue;
            const meta = SERVICE_META[key];
            if (!meta) continue;
            seen.add(key);
            out.push(meta);
        }
    }
    return out;
}

function titleize(raw: string): string {
    return raw
        .split(/[_-]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
