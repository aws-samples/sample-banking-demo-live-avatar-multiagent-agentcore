import type { ChunkParser } from "../types";

/**
 * Parses SSE chunks from LangGraph agents (stream_mode="messages").
 */

let currentToolUseId = "";

function extractDataPayload(line: string): string | null {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("data:")) return null;

    const raw = trimmed.slice(5);
    return raw.trim();
}

export const parseLanggraphChunk: ChunkParser = (line, callback) => {
    const data = extractDataPayload(line);
    if (!data) return;
    if (data === "[DONE]") return;

    try {
        const json = JSON.parse(data);

        // ToolMessage -- tool result
        if (json.type === "tool") {
            callback({
                type: "tool_result",
                toolUseId: json.tool_call_id,
                result:
                    typeof json.content === "string" ? json.content : JSON.stringify(json.content),
            });
            return;
        }

        // AIMessageChunk
        if (json.type === "AIMessageChunk") {
            if (typeof json.content === "string" && json.content) {
                callback({ type: "text", content: json.content });
            }

            if (Array.isArray(json.content)) {
                for (const block of json.content) {
                    if (block.type === "text" && block.text) {
                        callback({ type: "text", content: block.text });
                    }

                    if (block.type === "tool_use" && block.id && block.name) {
                        currentToolUseId = block.id;
                        callback({ type: "tool_use_start", toolUseId: block.id, name: block.name });
                    }

                    if (
                        block.type === "tool_use" &&
                        typeof block.partial_json === "string" &&
                        block.partial_json
                    ) {
                        callback({
                            type: "tool_use_delta",
                            toolUseId: currentToolUseId,
                            input: block.partial_json,
                        });
                    }
                }
            }

            const stopReason = json.response_metadata?.stop_reason;
            if (stopReason) {
                callback({ type: "result", stopReason });
            }
        }
    } catch {
        console.debug("Failed to parse langgraph event:", data);
    }
};
