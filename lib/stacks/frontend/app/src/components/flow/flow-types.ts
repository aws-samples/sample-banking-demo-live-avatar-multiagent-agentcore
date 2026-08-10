import type { AgentId } from "@/lib/agentcore-client/types";

/**
 * Accent color per agent. Used for the node's icon chip and the brass/emerald
 * status treatment. Kept in the AgentCore palette so the pipeline diagram reads
 * as part of the same platform as the concierge flow.
 */
export const AGENT_COLORS: Partial<Record<AgentId, string>> = {
    planner: "#4a9eff",
    researcher: "#8b8ef7",
    synthesizer: "#4fd1a5",
    evaluator: "#e0b850",
    menu_designer: "#ff9900",
    menu_pdf_writer: "#ff9900",
};

/**
 * AgentCore product icon per node (served from /agent-icons/*.svg). The user
 * node has no icon — it renders as a compact chip.
 */
export const AGENT_ICONS: Partial<Record<AgentId | "user", string>> = {
    planner: "/agent-icons/Runtime.svg",
    researcher: "/agent-icons/Gateway.svg",
    synthesizer: "/agent-icons/AI_Agent.svg",
    evaluator: "/agent-icons/Evaluations.svg",
    menu_designer: "/agent-icons/AI_Agent.svg",
    menu_pdf_writer: "/agent-icons/Code_Interpreter.svg",
};

export type NodeStatus = "pending" | "active" | "completed";

export interface AgentNodeData {
    agentId: AgentId | "user";
    label: string;
    status: NodeStatus;
    description: string;
    thinkingCount?: number;
    /** Tool key → call count for this step, used to render AWS-service chips. */
    toolCounts?: Record<string, number>;
    /** Position in the pipeline, used to stagger the node entrance animation. */
    orderIndex?: number;
    /** Opens the step inspector. Absent for steps with nothing to inspect. */
    onInspect?: () => void;
    [key: string]: unknown;
}
