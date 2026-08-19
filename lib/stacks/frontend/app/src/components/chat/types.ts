import type { AgentId } from "@/lib/agentcore-client/types";

export type MessageRole = "user" | "assistant";

export type ToolCallStatus = "streaming" | "executing" | "complete";

export interface ToolCall {
    toolUseId: string;
    name: string;
    input: string;
    result?: string;
    status: ToolCallStatus;
}

export type MessageSegment =
    | { type: "text"; content: string }
    | { type: "tool"; toolCall: ToolCall }
    | { type: "ui"; component: string; props: Record<string, unknown>; key: string };

export interface Message {
    role: MessageRole;
    content: string;
    timestamp: string;
    segments?: MessageSegment[];
}

export interface ChatSession {
    id: string;
    name: string;
    history: Message[];
    startDate: string;
    endDate: string;
}

/** Pipeline definition shape used by flow/progress components */
export interface PipelineAgent {
    id: AgentId;
    name: string;
    color: string;
}

/** Research agent pipeline colors for visualization */
export const AGENT_PIPELINE: PipelineAgent[] = [
    { id: "planner", name: "Planner", color: "#0972d3" },
    { id: "researcher", name: "Researcher", color: "#5f61e6" },
    { id: "synthesizer", name: "Synthesizer & Report", color: "#539d43" },
    { id: "evaluator", name: "Evaluator", color: "#c8a24a" },
];

/** Catalog agent pipeline colors for visualization.
 *
 * The four capabilities the AI Assistant must demonstrate each get a node so
 * they animate through idle → active → completed as the pipeline runs: the
 * designer drafts, quality control verifies, A/B evaluation compares two
 * models, and human review gates the export. (The continuous feedback loop is
 * its own always-on animated flywheel below the flow, since it spans runs.) */
export const MENU_PIPELINE: PipelineAgent[] = [
    { id: "menu_designer", name: "Catalog Designer", color: "#FF9900" },
    { id: "menu_qc", name: "Quality Control", color: "#4fd1a5" },
    { id: "menu_ab", name: "A/B Evaluation", color: "#8b8ef7" },
    { id: "menu_review", name: "Human Review", color: "#e0b850" },
    { id: "menu_pdf_writer", name: "PDF Writer", color: "#d91e18" },
];
