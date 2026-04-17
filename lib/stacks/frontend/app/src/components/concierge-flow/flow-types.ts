export type NodeCategory = "user" | "core" | "tool" | "resource";
export type NodeActivity = "idle" | "active" | "completed";

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
    [key: string]: unknown;
}

/**
 * Normalize a tool name from the MCP Gateway to the canonical tool key.
 * Gateway prefixes tools like "gateway_kb-search___kb_search" — we want "kb_search".
 */
export function normalizeToolName(raw: string): string {
    // MCP gateway format: "gateway_<target>___<tool_name>"
    const idx = raw.lastIndexOf("___");
    if (idx >= 0) return raw.slice(idx + 3);
    // Strip any leading "gateway_" prefix just in case
    return raw.startsWith("gateway_") ? raw.slice("gateway_".length) : raw;
}

/** Tool name (backend) → display label + optional icon override. */
/** Tool name (backend) → display label + optional icon override. */
export const TOOL_META: Record<string, { label: string; icon?: string; description: string }> = {
    kb_search: {
        label: "KB Search",
        description:
            "Hybrid semantic + keyword search over the Bedrock Knowledge Base (S3 Vectors, Nova Multimodal Embeddings) to retrieve grounded context from prior research reports and menus.",
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
    nova_canvas_generate: {
        label: "Canvas Generate",
        description:
            "Generates dish or design imagery via Amazon Nova Canvas. Images are stored in S3 with session-scoped history.",
    },
    nova_canvas_edit: {
        label: "Canvas Edit",
        description:
            "Edits existing images via Nova Canvas inpainting / outpainting for localized or expansive image modifications.",
    },
    nova_canvas_history: {
        label: "Canvas History",
        description: "Retrieves the history of Nova Canvas images generated during the session.",
    },
    nova_reel_generate: {
        label: "Reel Generate",
        description:
            "Generates short-form video via Amazon Nova Reel. Asynchronous job that returns a job id for status polling.",
    },
    nova_reel_status: {
        label: "Reel Status",
        description: "Polls a Nova Reel generation job for completion status.",
    },
    nova_reel_history: {
        label: "Reel History",
        description: "Retrieves the history of Nova Reel videos generated during the session.",
    },
    save_memory: {
        label: "Save Memory",
        description:
            "Persists a fact or event to AgentCore Memory across episodic, semantic, and user preference strategies. Events auto-expire after 30 days.",
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
            "Looks up the authenticated customer profile from DynamoDB to personalize the response (preferences, past orders).",
    },
    place_order: {
        label: "Place Order",
        description:
            "Places a restaurant order on behalf of the customer and records it in DynamoDB.",
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
            "Extracts embedded dish images from a menu PDF using an AgentCore Code Interpreter sandboxed Python session. Uploads images to S3 for reuse on the generated website.",
    },
    website_generator: {
        label: "Website Generator",
        description:
            "Generates or updates a live menu website (HTML/CSS) from the structured menu JSON and extracted dish images, hosted in S3 with a presigned URL.",
    },
    browser_start: {
        label: "Browser",
        icon: "/icons/agentcore/browser-tool.png",
        description:
            "Starts an AgentCore cloud browser session (sandboxed Chrome in a Firecracker microVM) and streams a live DCV view into the chat so the user watches the agent work. Followed by browser_navigate / click / type / get_text to drive interactions like booking a reservation.",
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
            "Content, topic, and word policy enforcement applied at the model invocation level for the chatbot mode. Blocks disallowed prompts and filters unsafe responses.",
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
        rawName: "concierge request",
        description: "The end user's message that initiates an orchestration turn.",
    },
};
