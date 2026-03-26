/** Supported agent framework patterns */
export type AgentPattern = "strands-single-agent" | "langgraph-single-agent";

/** Configuration for AgentCoreClient */
export interface AgentCoreConfig {
    runtimeArn: string;
    region?: string;
    pattern: AgentPattern;
}

/** Agent identifiers for multi-agent pipeline */
export type AgentId =
    | "planner"
    | "researcher"
    | "synthesizer"
    | "pdf_writer"
    | "menu_designer"
    | "menu_pdf_writer";

/** All pipeline phases (research + menu) */
export type PipelinePhase = "planning" | "research" | "synthesis" | "report" | "design" | "export";

/** Research pipeline phases (backward-compatible alias) */
export type ResearchPhase = PipelinePhase;

/** Stream event types emitted by parsers */
export type StreamEvent =
    | { type: "text"; content: string; _agent?: AgentId }
    | { type: "tool_use_start"; toolUseId: string; name: string }
    | { type: "tool_use_delta"; toolUseId: string; input: string }
    | { type: "tool_result"; toolUseId: string; result: string }
    | { type: "message"; role: string; content: unknown[] }
    | { type: "result"; stopReason: string }
    | { type: "lifecycle"; event: string }
    | {
          type: "agent_phase";
          agent: AgentId;
          phase: ResearchPhase;
          status: "start" | "end" | "error";
      }
    | { type: "agent_text"; agent: AgentId; content: string }
    | { type: "thinking"; agent: AgentId; content: string }
    | { type: "phase_progress"; phase: ResearchPhase; progress: number }
    | { type: "_ui"; component: string; props: Record<string, unknown> };

/** Callback invoked with each stream event */
export type StreamCallback = (event: StreamEvent) => void;

/** Parses a single SSE line and emits events via callback */
export type ChunkParser = (line: string, callback: StreamCallback) => void;
