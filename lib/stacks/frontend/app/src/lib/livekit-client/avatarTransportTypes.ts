/**
 * Transport-agnostic types shared by the avatar transport clients (LiveKit and
 * Tavus/Pipecat) and their pure message adapters.
 *
 * Kept in its own module — deliberately free of `import.meta` and any runtime —
 * so pure adapters (e.g. tavusMessages.ts) and their unit tests can import these
 * types without transitively pulling a client that uses `import.meta.env`
 * (which the repo-root CommonJS `tsc` cannot compile).
 */

/** One side of the conversation, streamed as it is spoken. */
export interface TranscriptUpdate {
    /** Stable per utterance, so a growing stream updates in place. */
    segmentId: string;
    role: "user" | "assistant";
    text: string;
    isFinal: boolean;
}

/** A tool call starting, or finishing with its raw result. */
export interface ToolActivity {
    callId: string;
    name: string;
    status: "running" | "done" | "error";
    /** Serialised call arguments; present from the start event. */
    input?: string;
    /** Raw tool output; only present once finished. */
    output?: string;
}

/** App-level connection state — matches websocket-client/client.ts ConnectionState. */
export type AvatarConnectionState =
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "error";
