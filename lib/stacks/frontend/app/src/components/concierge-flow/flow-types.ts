// `a2a` is the cross-team agent-to-agent collaboration node (the fraud-research
// hop). It is the one node that can reach a terminal `failed` state, so
// `NodeActivity` carries `failed` in addition to the shared idle/active/completed
// lifecycle used by every other node (Requirement 9.4).
//
// `prompt_opt` is the Bedrock Prompt Optimization showcase node. Like `a2a` it
// reuses the `failed`-capable `NodeActivity` because it can reach a terminal
// `failed` state when every target model fails (Requirement 9.4).
export type NodeCategory = "user" | "core" | "tool" | "resource" | "a2a" | "prompt_opt";
export type NodeActivity = "idle" | "active" | "completed" | "failed";

export interface ConciergeNodeData {
    id: string;
    label: string;
    sublabel?: string;
    icon?: string; // public path, e.g. /icons/agentcore/runtime.png
    category: NodeCategory;
    activity: NodeActivity;
    callCount?: number;
    /** When true, node is hidden until first activation (conditional reveal). */
    conditional?: boolean;
    revealed?: boolean;
    /**
     * When true, render the "identity carried" indicator on the node — used by
     * the A2A node to show the customer's verified identity travels across the
     * hop (Requirement 9.2).
     */
    identityCarried?: boolean;
    [key: string]: unknown;
}

/**
 * Normalize a tool name from the MCP Gateway to the canonical tool key.
 * Gateway prefixes tools like "gateway_kb-search___kb_search" — we want "kb_search".
 */
export function normalizeToolName(raw: string): string {
    // MCP gateway format: "gateway_<target>___<tool_name>"
    const idx = raw.lastIndexOf("___");
    let name = idx >= 0 ? raw.slice(idx + 3) : raw;
    // Strip any leading "gateway_" prefix just in case
    name = name.startsWith("gateway_") ? name.slice("gateway_".length) : name;
    // The AgentCore managed Web Search Tool connector exposes its tool as
    // "WebSearch"; map it to the existing "web_search" identity so the flow
    // diagram, tool catalog, and run report treat both implementations the same.
    if (name === "WebSearch") return "web_search";
    return name;
}

/** Tool name (backend) → display label + optional icon override. */
/** Tool name (backend) → display label + optional icon override. */
export const TOOL_META: Record<string, { label: string; icon?: string; description: string }> = {
    kb_search: {
        label: "KB Search",
        description:
            "Hybrid semantic + keyword search over the Bedrock Knowledge Base (S3 Vectors, Nova Multimodal Embeddings) to retrieve grounded context from prior research reports and product catalogs.",
    },
    web_search: {
        label: "Web Search",
        description:
            "Web-grounded search powered by Nova Pro. Returns live sources with citations for the researcher and chatbot to synthesize into answers.",
    },
    pdf_generator: {
        label: "PDF Generator",
        description:
            "Generates 12-section research PDF reports via ReportLab and uploads to S3, returning a presigned URL. Handles cover page, TOC, findings, citations, and appendices.",
    },
    image_generate: {
        label: "Generate Image",
        description:
            "Generates product or design imagery via Stability SD3.5 (Stable Diffusion) on Bedrock. Images are stored in S3 with session-scoped history.",
    },
    image_history: {
        label: "Image History",
        description: "Retrieves the history of images generated during the session.",
    },

    recall_memories: {
        label: "Recall Memory",
        description:
            "Retrieves relevant memories from AgentCore Memory across episodic, semantic, and user preference strategies for context-aware responses.",
    },
    analyze_patterns: {
        label: "Analyze Patterns",
        description: "Analyzes conversation patterns across a session to surface recurring themes.",
    },
    retrieve_user_profile: {
        label: "User Profile",
        description:
            "Looks up the authenticated customer profile from DynamoDB to personalize the response (preferences, account history).",
    },
    open_account: {
        label: "Open Account",
        description:
            "Submits a bank account application on behalf of the customer after KYC verification and records it in DynamoDB.",
    },
    data_sources: {
        label: "Data Sources",
        description:
            "Lists the data sources available for research, including KBs and external feeds.",
    },
    extract_pdf_images: {
        label: "Extract PDF Images",
        icon: "/icons/agentcore/code-interpreter.png",
        description:
            "Extracts embedded product images from a catalog PDF using an AgentCore Code Interpreter sandboxed Python session. Uploads images to S3 for reuse on the generated website.",
    },
    website_generator: {
        label: "Website Generator",
        description:
            "Generates or updates a live product website (HTML/CSS) from the structured catalog JSON and extracted product images, hosted in S3 with a presigned URL.",
    },
    browser_start: {
        label: "Browser",
        icon: "/icons/agentcore/browser-tool.png",
        description:
            "Starts an AgentCore cloud browser session (sandboxed Chrome in a Firecracker microVM) and streams a live DCV view into the chat so the user watches the agent work. Followed by browser_navigate / click / type / get_text to drive interactions like submitting an account application.",
    },
    browser_navigate: {
        label: "Browser Navigate",
        icon: "/icons/agentcore/browser-tool.png",
        description: "Navigate the AgentCore browser to a URL.",
    },
    browser_click: {
        label: "Browser Click",
        icon: "/icons/agentcore/browser-tool.png",
        description: "Click an element in the AgentCore browser by CSS selector.",
    },
    browser_type: {
        label: "Browser Type",
        icon: "/icons/agentcore/browser-tool.png",
        description: "Type text into an input element in the AgentCore browser.",
    },
    browser_get_text: {
        label: "Browser Read",
        icon: "/icons/agentcore/browser-tool.png",
        description: "Read visible text from the current page in the AgentCore browser.",
    },
    browser_press_key: {
        label: "Browser Press Key",
        icon: "/icons/agentcore/browser-tool.png",
        description: "Press a keyboard key in the AgentCore browser.",
    },
    browser_stop: {
        label: "Browser Stop",
        icon: "/icons/agentcore/browser-tool.png",
        description: "Stop the AgentCore browser session and release resources.",
    },
};

/** Tools that trigger reveal of a conditional downstream node. */
export const CONDITIONAL_REVEAL: Record<string, string> = {
    kb_search: "knowledge_base",
    extract_pdf_images: "code_interpreter",
    browser_start: "browser",
};

/** Rich descriptions for core architecture nodes (non-tools). */
export const CORE_NODE_META: Record<
    string,
    { label: string; rawName: string; description: string }
> = {
    runtime: {
        label: "AgentCore Runtime",
        rawName: "bedrock-agentcore-runtime · orchestrator",
        description:
            "Serverless HTTP/SSE runtime running the in-process multi-agent orchestrator on Claude Sonnet 4.6. Handles 6 modes (research, menu, chatbot, …) and streams tokens + tool events back to the client.",
    },
    gateway: {
        label: "AgentCore Gateway",
        rawName: "bedrock-agentcore-gateway · MCP",
        description:
            "Managed MCP server that exposes 16+ Lambda-backed tools to the runtime. Authenticates agents via Cognito M2M OAuth2 and routes tool calls to the corresponding Lambda function.",
    },
    memory: {
        label: "AgentCore Memory",
        rawName: "bedrock-agentcore-memory",
        description:
            "Persistent memory service with three strategies: episodic (session-scoped with reflection), semantic (cross-session facts), and user preference. Events auto-expire after 30 days.",
    },
    guardrails: {
        label: "Bedrock Guardrails",
        rawName: "bedrock-guardrails",
        description:
            "Content, topic, word, and PII/DLP policy enforcement applied at the model invocation level for the chatbot mode. Blocks off-topic prompts (e.g. politics), refuses confidential data such as employee salaries, and redacts sensitive identifiers (SSN, card, bank account) in both prompts and responses.",
    },
    knowledge_base: {
        label: "Knowledge Base",
        rawName: "bedrock-knowledge-base · S3 Vectors",
        description:
            "Bedrock Knowledge Base backed by S3 Vectors (1024-dim, FLOAT32, cosine) with Nova Multimodal Embeddings. Auto-ingests generated PDFs via S3 event notifications.",
    },
    code_interpreter: {
        label: "Code Interpreter",
        rawName: "bedrock-agentcore-code-interpreter",
        description:
            "Sandboxed Python execution environment used by tools that need to parse PDFs, run data analysis, or execute code. Session-scoped and isolated.",
    },
    browser: {
        label: "Browser",
        rawName: "bedrock-agentcore-browser",
        description:
            "Fast, cloud-sandboxed Chrome browser (Firecracker microVM) that agents drive via CDP/Playwright. A live DCV view can be streamed into the chat so users watch every click in real time.",
    },
    user: {
        label: "User",
        rawName: "client request",
        description: "The end user's message that initiates an orchestration turn.",
    },
    fraud_research: {
        label: "Fraud Research Agent",
        rawName: "bedrock-agentcore-runtime · A2A callee",
        description:
            "Another team's Fraud & Research Agent, deployed as its own AgentCore Runtime and reached over the A2A protocol during account-opening KYC. The account-opening agent discovers it via its agent card and invokes it, carrying the customer's verified identity across the hop so the whole path lands in one trace attributed to two owners.",
    },
    prompt_optimization: {
        label: "Prompt Optimization",
        rawName: "bedrock · OptimizePrompt",
        description:
            "Presenter-driven Bedrock Prompt Optimization showcase. Streams the AI Agent's current system prompt through the OptimizePrompt API for up to three verified foundation models, surfacing each model-tailored analysis and optimized prompt for side-by-side review. The node is active while requests stream, completed when the presenter applies a selected variant to the live agent, and failed when every target model fails.",
    },
};
