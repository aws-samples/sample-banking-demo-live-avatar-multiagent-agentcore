import type { AgentId, ChunkParser, ResearchPhase, StreamEvent } from "../types";

type PromptOptEvent = Extract<StreamEvent, { type: "prompt_opt" }>;

function extractDataPayload(line: string): string | null {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("data:")) return null;

    const raw = trimmed.slice(5);
    return raw.trim();
}

/**
 * Parses SSE chunks from Strands agents.
 * Emits typed StreamEvents for text, tool use, messages, lifecycle,
 * and multi-agent pipeline events (agent_phase, agent_text, thinking, phase_progress).
 */
export const parseStrandsChunk: ChunkParser = (line, callback) => {
    const data = extractDataPayload(line);
    if (!data) return;
    if (data === "[DONE]") return;

    try {
        const json = JSON.parse(data);

        // Terminal backend error. The orchestrator emits
        // {"status": "error", "error": "..."} and then stops streaming, so this
        // must be surfaced or the UI spins forever on the phase that failed.
        if (json.status === "error") {
            callback({
                type: "stream_error",
                message:
                    typeof json.error === "string" && json.error
                        ? json.error
                        : "The agent pipeline failed.",
            });
            return;
        }

        // Generative UI event
        if (json._ui) {
            callback({ type: "_ui", component: json._ui.component, props: json._ui.props ?? {} });
            return;
        }

        // Multi-agent: agent phase transition
        if (json.agent_phase) {
            const rawStatus = json.agent_phase.status;
            const status: "start" | "end" | "error" =
                rawStatus === "end" || rawStatus === "error" ? rawStatus : "start";

            callback({
                type: "agent_phase",
                agent: json.agent_phase.agent as AgentId,
                phase: json.agent_phase.phase as ResearchPhase,
                status,
            });
            return;
        }

        // Multi-agent: agent-attributed text
        if (json.agent_text) {
            callback({
                type: "agent_text",
                agent: json.agent_text.agent as AgentId,
                content: json.agent_text.content,
            });
            return;
        }

        // Multi-agent: thinking trace
        if (json.thinking) {
            callback({
                type: "thinking",
                agent: json.thinking.agent as AgentId,
                content: json.thinking.content,
            });
            return;
        }

        // Multi-agent: phase progress
        if (json.phase_progress) {
            callback({
                type: "phase_progress",
                phase: json.phase_progress.phase as ResearchPhase,
                progress: json.phase_progress.progress,
            });
            return;
        }

        // A2A collaboration: the account-opening agent consulting the
        // fraud-research agent over the agent-to-agent protocol.
        if (json.a2a_call) {
            const rawStatus = json.a2a_call.status;
            const status: "start" | "end" | "error" =
                rawStatus === "end" || rawStatus === "error" ? rawStatus : "start";
            callback({
                type: "a2a_call",
                agent: json.a2a_call.agent as AgentId,
                phase: "collaboration",
                status,
                identityForwarded: json.a2a_call.identity_forwarded === true,
            });
            return;
        }

        // Prompt Optimization showcase: per-model OptimizePrompt analysis /
        // optimized prompt, step lifecycle, and before/after sample answers.
        // Maps the snake_case backend payload to the typed camelCase event,
        // mirroring the a2a_call branch above.
        if (json.prompt_opt) {
            const p = json.prompt_opt;
            const event: PromptOptEvent = {
                type: "prompt_opt",
                targetModelId: typeof p.target_model_id === "string" ? p.target_model_id : "",
                modelLabel: typeof p.model_label === "string" ? p.model_label : "",
                kind: p.kind as PromptOptEvent["kind"],
                text: typeof p.text === "string" ? p.text : "",
            };
            if (p.variant === "baseline" || p.variant === "candidate") {
                event.variant = p.variant;
            }
            if (typeof p.optimized_for_model_id === "string") {
                event.optimizedForModelId = p.optimized_for_model_id;
            }
            callback(event);
            return;
        }

        // AgentCore Payments: actual spend committed for the run.
        if (json.payment_spend) {
            callback({
                type: "payment_spend",
                spent: String(json.payment_spend.spent ?? "0"),
                budget: String(json.payment_spend.budget ?? "0"),
                currency: String(json.payment_spend.currency ?? "USD"),
                sessions: Number(json.payment_spend.sessions ?? 0),
            });
            return;
        }

        // Text streaming (may include _agent field from orchestrator)
        if (typeof json.data === "string") {
            const event: { type: "text"; content: string; _agent?: AgentId } = {
                type: "text",
                content: json.data,
            };
            if (json._agent) {
                event._agent = json._agent as AgentId;
            }
            callback(event);
            return;
        }

        // Tool use streaming
        if (json.current_tool_use) {
            const tool = json.current_tool_use;
            if (json.delta?.toolUse?.input === "") {
                callback({
                    type: "tool_use_start",
                    toolUseId: tool.toolUseId,
                    name: tool.name,
                    // Metrics-only calls (parallel research workers) are counted
                    // but never rendered as chat cards — they have no streamed
                    // arguments or result to show.
                    telemetryOnly: json.telemetry_only === true,
                });
            } else if (json.delta?.toolUse?.input) {
                callback({
                    type: "tool_use_delta",
                    toolUseId: tool.toolUseId,
                    input: json.delta.toolUse.input,
                });
            }
            return;
        }

        // Complete message
        if (json.message) {
            const msg = json.message;
            callback({ type: "message", role: msg.role, content: msg.content });

            if (Array.isArray(msg.content)) {
                for (const block of msg.content) {
                    if (block.toolResult) {
                        const resultText =
                            block.toolResult.content
                                ?.map((c: { text?: string }) => c.text)
                                .filter(Boolean)
                                .join("") || JSON.stringify(block.toolResult.content);
                        callback({
                            type: "tool_result",
                            toolUseId: block.toolResult.toolUseId,
                            result: resultText,
                        });
                    }
                }
            }
            return;
        }

        // Final result
        if (json.result) {
            callback({
                type: "result",
                stopReason: typeof json.result === "object" ? json.result.stop_reason : "end_turn",
            });
            return;
        }

        // Lifecycle events
        if (json.init_event_loop || json.start_event_loop || json.start) {
            const event = json.init_event_loop
                ? "init"
                : json.start_event_loop
                  ? "start_loop"
                  : "start";
            callback({ type: "lifecycle", event });
            return;
        }
    } catch {
        console.debug("Failed to parse strands event:", data);
    }
};
