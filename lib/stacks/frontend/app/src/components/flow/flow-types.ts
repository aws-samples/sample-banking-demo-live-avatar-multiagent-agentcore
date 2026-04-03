import type { AgentId } from "@/lib/agentcore-client/types";

export const AGENT_COLORS: Partial<Record<AgentId, string>> = {
    planner: "#0972d3",
    researcher: "#5f61e6",
    synthesizer: "#539d43",
    menu_designer: "#FF9900",
    menu_pdf_writer: "#FF9900",
};

export type NodeStatus = "pending" | "active" | "completed";

export interface AgentNodeData {
    agentId: AgentId | "user";
    label: string;
    status: NodeStatus;
    description: string;
    thinkingCount?: number;
    [key: string]: unknown;
}
