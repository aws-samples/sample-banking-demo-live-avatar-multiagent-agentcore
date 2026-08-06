/**
 * Pure mapping from the Pipecat worker's data-channel messages to the
 * transcript / tool-activity shapes the avatar UI already consumes.
 *
 * Kept free of Daily/DOM imports so it can be unit-tested directly, and so the
 * wire contract between the worker and the browser lives in one place. The
 * worker publishes two message types (see
 * `patterns/tavus-pipecat-agent/transcript_forwarders.py` and
 * `gateway_toolset.py`):
 *   { type: "transcript", role: "user"|"agent", text, final }
 *   { type: "tool", callId, name, status, input?, output? }
 * which map onto the same `TranscriptUpdate` / `ToolActivity` the LiveKit path
 * produces, so the transcript panel and tool cards are reused unchanged.
 */

import type { ToolActivity, TranscriptUpdate } from "../livekit-client/avatarTransportTypes";

export type WorkerMessage =
    | { type: "transcript"; role: "user" | "agent"; text: string; final: boolean }
    | {
          type: "tool";
          callId: string;
          name: string;
          status: "running" | "done" | "error";
          input?: string;
          output?: string;
      };

export type MappedMessage =
    | { kind: "transcript"; update: TranscriptUpdate; agentSpeaking: boolean | null }
    | { kind: "tool"; activity: ToolActivity }
    | { kind: "ignore" };

/** Parse a raw data-channel payload (string or object) into a WorkerMessage. */
export function parseWorkerMessage(raw: unknown): WorkerMessage | null {
    if (raw == null) return null;
    let obj: unknown = raw;
    if (typeof raw === "string") {
        try {
            obj = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (typeof obj !== "object" || obj === null) return null;
    const type = (obj as { type?: unknown }).type;
    if (type === "transcript") {
        const m = obj as Record<string, unknown>;
        if ((m.role !== "user" && m.role !== "agent") || typeof m.text !== "string") return null;
        return { type: "transcript", role: m.role, text: m.text, final: Boolean(m.final) };
    }
    if (type === "tool") {
        const m = obj as Record<string, unknown>;
        if (typeof m.name !== "string") return null;
        const status = m.status;
        if (status !== "running" && status !== "done" && status !== "error") return null;
        return {
            type: "tool",
            callId: typeof m.callId === "string" ? m.callId : "",
            name: m.name,
            status,
            input: typeof m.input === "string" ? m.input : undefined,
            output: typeof m.output === "string" ? m.output : undefined,
        };
    }
    return null;
}

/** Map a WorkerMessage to the UI callback payloads. */
export function mapWorkerMessage(msg: WorkerMessage): MappedMessage {
    if (msg.type === "transcript") {
        const update: TranscriptUpdate = {
            // The worker keys transcript updates by role for this simple panel;
            // a per-utterance id is not sent, so role is a stable segment key.
            segmentId: `tavus-${msg.role}`,
            role: msg.role === "agent" ? "assistant" : "user",
            text: msg.text,
            isFinal: msg.final,
        };
        // Only the agent role carries a speaking signal: it is speaking while a
        // non-final agent transcript streams, and done on the final one.
        const agentSpeaking = msg.role === "agent" ? !msg.final : null;
        return { kind: "transcript", update, agentSpeaking };
    }
    return {
        kind: "tool",
        activity: {
            callId: msg.callId,
            name: msg.name,
            status: msg.status,
            input: msg.input,
            output: msg.output,
        } satisfies ToolActivity,
    };
}
