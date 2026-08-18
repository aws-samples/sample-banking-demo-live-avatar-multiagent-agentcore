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
    | "evaluator"
    | "menu_designer"
    | "menu_pdf_writer"
    | "fraud_research";

/** All pipeline phases (research + menu) */
export type PipelinePhase =
    | "planning"
    | "research"
    | "synthesis & report"
    | "evaluation"
    | "design"
    | "export";

/** Research pipeline phases (backward-compatible alias) */
export type ResearchPhase = PipelinePhase;

/** Stream event types emitted by parsers */
export type StreamEvent =
    | { type: "text"; content: string; _agent?: AgentId }
    /**
     * `telemetryOnly` marks a tool call reported for metrics only — the
     * parallel researcher's worker sub-agents, whose arguments and results are
     * never streamed. Counted in the flow diagram and run report, but kept out
     * of the chat transcript where it would render as an empty dropdown.
     */
    | { type: "tool_use_start"; toolUseId: string; name: string; telemetryOnly?: boolean }
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
    /**
     * Terminal backend failure. The orchestrator yields
     * `{"status": "error", "error": "..."}` when a pipeline phase raises. Without
     * this event the payload was silently dropped by the parser and the UI span
     * forever on the failed phase instead of reporting the error.
     */
    | { type: "stream_error"; message: string }
    /**
     * Real spend committed via AgentCore Payments for this run. Distinct from
     * the run report's estimated inference cost — this figure comes from the
     * payment session, not from per-unit assumptions.
     */
    | {
          type: "payment_spend";
          spent: string;
          budget: string;
          currency: string;
          sessions: number;
      }
    /**
     * Agent-to-agent (A2A) collaboration step. Emitted by the account-opening
     * agent when it consults the fraud-research agent over A2A during the
     * KYC/fraud step. `identityForwarded` reflects that the customer's verified
     * identity is carried across the hop. Drives the dedicated flow-panel node.
     */
    | {
          type: "a2a_call";
          agent: AgentId;
          phase: "collaboration";
          status: "start" | "end" | "error";
          identityForwarded: boolean;
      }
    /**
     * Prompt Optimization showcase step. Emitted by the orchestrator's
     * `optimize_prompt` / `optimize_sample` handlers as the AI Agent's
     * Current_System_Prompt is optimized toward each verified target model via
     * Bedrock `OptimizePrompt`. Drives the `PromptOptimizationShowcase` card
     * (per-model analysis → optimized prompt) and the dedicated flow-panel node.
     * `targetModelId` is `""` for step-level events (`step_start` /
     * `step_complete` / `step_failed`) and for before/after `sample` events;
     * `optimizedForModelId` records the model a prompt was optimized for so the
     * card can flag a provenance mismatch.
     */
    | {
          type: "prompt_opt";
          targetModelId: string;
          modelLabel: string;
          kind:
              | "step_start"
              | "analysis"
              | "optimized"
              | "in_progress"
              | "error"
              | "invalid_target"
              | "step_complete"
              | "step_failed"
              | "sample"
              | "sample_error";
          text: string;
          variant?: "baseline" | "candidate";
          optimizedForModelId?: string;
      }
    | { type: "_ui"; component: string; props: Record<string, unknown> };

/** Callback invoked with each stream event */
export type StreamCallback = (event: StreamEvent) => void;

/** Parses a single SSE line and emits events via callback */
export type ChunkParser = (line: string, callback: StreamCallback) => void;
