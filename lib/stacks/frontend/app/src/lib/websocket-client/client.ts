/**
 * WebSocket client for Avatar AgentCore Runtime.
 *
 * Connects to the AgentCore WebSocket endpoint for real-time
 * speech-to-speech conversation with Nova Sonic.
 *
 * Message types:
 * - audio: PCM audio frames (base64-encoded)
 * - text: Transcript text chunks
 * - toolInvocation: Tool call results (images, videos, etc.)
 * - sessionStart/sessionEnd: Session lifecycle
 * - error: Error messages
 */

import type { LanguageCode } from "./voice-config";

export type PersonaId = "friendly" | "professional" | "educational" | "creative" | "technical";

/** Logical KB pipeline views — must match the backend taxonomy. */
export type KbPipeline = "bistro_research" | "open_research" | "menu";

export const ALL_KB_PIPELINES: readonly KbPipeline[] = [
    "bistro_research",
    "open_research",
    "menu",
] as const;

export interface AvatarWSConfig {
    /** AgentCore Runtime ARN for the avatar runtime */
    runtimeArn: string;
    /** AWS region (default: us-east-1) */
    region?: string;
    /** Session ID for continuity */
    sessionId: string;
    /** Selected persona */
    persona?: PersonaId;
    /** Language code for speech */
    language?: LanguageCode;
    /** Voice ID for TTS */
    voiceId?: string;
    /** Initial KB pipeline multi-select. Empty / undefined = search all views. */
    kbPipelines?: KbPipeline[];
    /**
     * Cognito ID token. Sent inside the first `sessionStart` JSON message
     * so the backend can extract the user's `sub` claim and attach
     * UserScopeHook. The AgentCore Runtime WebSocket proxy does not
     * forward query-string params to the inner container, so this cannot
     * travel on the URL. Without it, the backend closes the socket with
     * code 4401 and this client stops reconnecting after maxReconnectAttempts.
     */
    idToken?: string;
}

export type AvatarWSMessageType =
    | "sessionStart"
    | "audio"
    | "text"
    | "toolInvocation"
    | "toolResult"
    | "sessionEnd"
    | "error";

export interface AvatarWSMessage {
    type: AvatarWSMessageType;
    /** Base64-encoded PCM audio data (for audio type) */
    audioData?: string;
    /** Text content (for text/error types) */
    content?: string;
    /** Speaker role for text messages (user transcript vs assistant response) */
    role?: "user" | "assistant";
    /** Tool invocation details (for toolInvocation type) */
    toolName?: string;
    toolInput?: string;
    toolResult?: string;
    /** Image or video URL from tool result */
    mediaUrl?: string;
    mediaType?: "image" | "video";
    /** Session metadata */
    sessionId?: string;
    persona?: PersonaId;
}

export type AvatarWSCallback = (message: AvatarWSMessage) => void;

/** Connection state */
export type ConnectionState =
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "error";

export class AvatarWebSocketClient {
    private ws: WebSocket | null = null;
    private config: AvatarWSConfig;
    private callback: AvatarWSCallback;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 1000;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
    private _state: ConnectionState = "disconnected";
    private onStateChange?: (state: ConnectionState) => void;
    private lastPresignedUrl: string | null = null;

    constructor(
        config: AvatarWSConfig,
        callback: AvatarWSCallback,
        onStateChange?: (state: ConnectionState) => void
    ) {
        this.config = config;
        this.callback = callback;
        this.onStateChange = onStateChange;
    }

    get state(): ConnectionState {
        return this._state;
    }

    private setState(state: ConnectionState): void {
        this._state = state;
        this.onStateChange?.(state);
    }

    /**
     * Opens a WebSocket connection using a SigV4-presigned URL.
     *
     * AgentCore Runtime WebSocket endpoints only accept SigV4 headers,
     * SigV4-presigned URLs, or OAuth Bearer tokens in the `Authorization`
     * header. Browsers cannot set arbitrary WebSocket headers, and
     * subprotocol-based auth is not honored by the AgentCore proxy, so
     * the presigned URL is the only viable browser path.
     *
     * @param presignedUrl - A SigV4-presigned wss:// URL produced by
     *   presignAgentCoreWebSocket().
     */
    connect(presignedUrl: string): void {
        if (
            this.ws &&
            (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
        ) {
            return;
        }

        this.setState("connecting");

        this.ws = new WebSocket(presignedUrl);
        // Cache the URL so reconnect attempts can reuse it. Presigned
        // URLs expire (5 min default), so after that window the caller
        // must tear down and re-open with a fresh presign.
        this.lastPresignedUrl = presignedUrl;

        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
            this.setState("connected");
            this.reconnectAttempts = 0;

            // Start keepalive ping every 30 seconds
            this.startKeepalive();

            // Send session start with persona + language config + id_token.
            // idToken carries the user's Cognito `sub` claim — the backend
            // closes the socket with 4401 if missing or invalid.
            this.sendJSON({
                type: "sessionStart",
                sessionId: this.config.sessionId,
                persona: this.config.persona ?? "friendly",
                language: this.config.language ?? "en-US",
                voiceId: this.config.voiceId ?? "tiffany",
                kbPipelines: this.config.kbPipelines ?? [],
                idToken: this.config.idToken ?? "",
            });
        };

        this.ws.onmessage = (event: MessageEvent) => {
            this.handleMessage(event);
        };

        this.ws.onerror = () => {
            this.setState("error");
        };

        this.ws.onclose = (event: CloseEvent) => {
            this.stopKeepalive();
            console.log(
                `[AvatarWS] Connection closed: code=${event.code} reason="${event.reason}" wasClean=${event.wasClean}`
            );

            if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                this.attemptReconnect();
            } else {
                this.setState("disconnected");
            }
        };
    }

    /**
     * Handles incoming WebSocket messages.
     */
    private handleMessage(event: MessageEvent): void {
        try {
            // Binary message -- raw PCM audio
            if (event.data instanceof ArrayBuffer) {
                const bytes = new Uint8Array(event.data);
                let binary = "";
                for (let i = 0; i < bytes.byteLength; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const base64 = btoa(binary);
                this.callback({
                    type: "audio",
                    audioData: base64,
                });
                return;
            }

            // Text message -- JSON
            const message = JSON.parse(event.data as string) as AvatarWSMessage;
            this.callback(message);
        } catch (err) {
            console.error("Failed to parse WebSocket message:", err);
        }
    }

    /**
     * Starts a keepalive ping every 30 seconds to prevent idle timeouts.
     */
    private startKeepalive(): void {
        this.stopKeepalive();
        this.keepaliveTimer = setInterval(() => {
            this.sendJSON({ type: "ping" });
        }, 30_000);
    }

    /**
     * Stops the keepalive ping interval.
     */
    private stopKeepalive(): void {
        if (this.keepaliveTimer) {
            clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = null;
        }
    }

    /**
     * Attempts to reconnect with exponential backoff.
     */
    private attemptReconnect(): void {
        this.setState("reconnecting");
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

        this.reconnectTimer = setTimeout(
            () => {
                // Presigned URLs expire (5 min default from sigv4.ts). If
                // the cached URL is still within its window this will
                // succeed; otherwise the server closes with 403 and the
                // caller must re-open with a fresh presign via
                // AvatarInterface.connect().
                if (this.lastPresignedUrl) {
                    this.connect(this.lastPresignedUrl);
                }
            },
            Math.min(delay, 30000)
        );
    }

    /**
     * Sends base64-encoded PCM audio to the server.
     */
    sendAudio(base64Audio: string): void {
        this.sendJSON({
            type: "audio",
            audioData: base64Audio,
        });
    }

    /**
     * Sends a text prompt to the server (for text-based interaction).
     */
    sendText(text: string): void {
        this.sendJSON({
            type: "text",
            content: text,
        });
    }

    /**
     * Sends a raw ArrayBuffer of PCM audio to the server.
     */
    sendAudioBuffer(buffer: ArrayBuffer): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(buffer);
        }
    }

    /**
     * Sends a JSON message over the WebSocket.
     */
    private sendJSON(data: Record<string, unknown>): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    /**
     * Updates the persona for the current session.
     */
    updatePersona(persona: PersonaId): void {
        this.config.persona = persona;
        this.sendJSON({
            type: "personaChange",
            persona,
        });
    }

    /**
     * Updates the language for the current session.
     */
    updateLanguage(language: LanguageCode): void {
        this.config.language = language;
        this.sendJSON({
            type: "languageChange",
            language,
        });
    }

    /**
     * Updates the voice for the current session.
     */
    updateVoice(voiceId: string): void {
        this.config.voiceId = voiceId;
        this.sendJSON({
            type: "voiceChange",
            voiceId,
        });
    }

    /**
     * Updates the KB pipeline multi-select for the current session.
     * Empty array means "search every view".
     */
    updateKbPipelines(pipelines: KbPipeline[]): void {
        this.config.kbPipelines = [...pipelines];
        this.sendJSON({
            type: "kbPipelinesChange",
            kbPipelines: pipelines,
        });
    }

    /**
     * Closes the WebSocket connection.
     */
    disconnect(): void {
        this.stopKeepalive();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
        if (this.ws) {
            this.ws.close(1000, "Client disconnect");
            this.ws = null;
        }
        this.setState("disconnected");
    }
}
