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
export const TOOL_META: Record<string, { label: string; icon?: string }> = {
    kb_search: { label: "KB Search" },
    web_search: { label: "Web Search" },
    pdf_generator: { label: "PDF Generator" },
    nova_canvas_generate: { label: "Canvas Generate" },
    nova_canvas_edit: { label: "Canvas Edit" },
    nova_canvas_history: { label: "Canvas History" },
    nova_reel_generate: { label: "Reel Generate" },
    nova_reel_status: { label: "Reel Status" },
    nova_reel_history: { label: "Reel History" },
    save_memory: { label: "Save Memory" },
    recall_memories: { label: "Recall Memory" },
    analyze_patterns: { label: "Analyze Patterns" },
    retrieve_user_profile: { label: "User Profile" },
    place_order: { label: "Place Order" },
    data_sources: { label: "Data Sources" },
    extract_pdf_images: {
        label: "Extract PDF Images",
        icon: "/icons/agentcore/code-interpreter.png",
    },
    website_generator: { label: "Website Generator" },
};

/** Tools that trigger reveal of a conditional downstream node. */
export const CONDITIONAL_REVEAL: Record<string, string> = {
    kb_search: "knowledge_base",
    extract_pdf_images: "code_interpreter",
};
