/**
 * LiveKit WebRTC client for the Avatar "Relationship Manager".
 *
 * Alternate transport to the AgentCore-WebSocket path (see
 * ../websocket-client/client.ts). Gated behind VITE_LIVEKIT_TOKEN_URL:
 * when that env var is set, AvatarInterface uses this client instead of
 * the SigV4 presigned WebSocket + mic AudioWorklet.
 *
 * Flow:
 *  1. fetchToken() — POST to the Cognito-protected token endpoint,
 *     mirroring feedbackService (Authorization: Bearer <id_token>).
 *  2. connect() — join the LiveKit room and publish the local mic.
 *  3. On the agent's subscribed audio track, attach it for playback and
 *     drive the 3D avatar's mouth from an AnalyserNode RMS (0..1) rather
 *     than the base64-PCM lipSyncAnalyzer (which cannot consume a
 *     MediaStreamTrack).
 */

import {
    Room,
    RoomEvent,
    Track,
    ConnectionState as LiveKitConnectionState,
    type RemoteTrack,
    type RemoteTrackPublication,
    type RemoteParticipant,
} from "livekit-client";

/**
 * Topic the agents framework publishes conversation text on. Both sides arrive
 * here — the agent's own speech and the transcription of the caller's — each
 * stream tagged with the identity of whoever the text belongs to.
 */
const TOPIC_TRANSCRIPTION = "lk.transcription";

/** Topic our worker publishes tool activity on. See TOOL_ACTIVITY_TOPIC. */
const TOPIC_TOOL_ACTIVITY = "trb.tool";

/**
 * Topic the agent accepts typed input on. Registered by the agents framework's
 * room I/O whenever text input is enabled, which it is by default, so typing
 * reaches the model without any worker-side change.
 */
const TOPIC_CHAT = "lk.chat";

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

/** Response shape from the LiveKit token endpoint. */
export interface LiveKitTokenResponse {
    serverUrl: string;
    token: string;
    roomName: string;
}

export interface AvatarLiveKitOptions {
    /** Cognito ID token (auth.user.id_token) — same token feedbackService sends. */
    idToken: string;
    /** Normalized RMS (0..1) of the agent's voice for the avatar mouth. */
    onAudioLevel?: (level: number) => void;
    /** Fires when the agent starts/stops speaking (RMS threshold). */
    onSpeakingChange?: (isSpeaking: boolean) => void;
    /** Connection lifecycle updates. */
    onConnectionState?: (state: AvatarConnectionState) => void;
    /**
     * The agent's remote audio track, surfaced so a photorealistic avatar can
     * run its own viseme detection on the raw signal (see TalkingHeadAvatar).
     * Called with `null` when the track goes away.
     */
    onAudioTrack?: (track: MediaStreamTrack | null) => void;
    /**
     * Conversation text as it is spoken, for the transcript panel. Fires
     * repeatedly for one utterance with the text so far, then once more with
     * `isFinal`.
     */
    onTranscript?: (update: TranscriptUpdate) => void;
    /** Tool calls starting and finishing, for tool cards and result artifacts. */
    onToolActivity?: (activity: ToolActivity) => void;
    /** Non-fatal and fatal errors. */
    onError?: (error: Error) => void;
}

/** RMS above this (0..1) counts as "speaking". */
const SPEAKING_RMS_THRESHOLD = 0.02;

function mapConnectionState(state: LiveKitConnectionState): AvatarConnectionState {
    switch (state) {
        case LiveKitConnectionState.Connecting:
            return "connecting";
        case LiveKitConnectionState.Connected:
            return "connected";
        case LiveKitConnectionState.Reconnecting:
        case LiveKitConnectionState.SignalReconnecting:
            return "reconnecting";
        case LiveKitConnectionState.Disconnected:
        default:
            return "disconnected";
    }
}

export class AvatarLiveKitClient {
    private readonly options: AvatarLiveKitOptions;
    private room: Room | null = null;
    private audioEl: HTMLAudioElement | null = null;
    private audioContext: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private rafId: number | null = null;
    private wasSpeaking = false;

    constructor(options: AvatarLiveKitOptions) {
        this.options = options;
    }

    /**
     * POST to VITE_LIVEKIT_TOKEN_URL with the Cognito Authorization header
     * (mirrors feedbackService: `Bearer <id_token>`) and return the
     * LiveKit connection details.
     */
    async fetchToken(): Promise<LiveKitTokenResponse> {
        const base = import.meta.env.VITE_LIVEKIT_TOKEN_URL;
        if (!base) {
            throw new Error("VITE_LIVEKIT_TOKEN_URL is not configured");
        }

        // VITE_LIVEKIT_TOKEN_URL is the API Gateway stage root (ends with "/"),
        // so the resource path must be appended — mirroring
        // services/feedbackService.ts (`${base}feedback`). POSTing to the bare
        // root hits no method and API Gateway answers 403 without CORS headers,
        // which surfaces in the browser as an opaque NetworkError/CORS failure.
        const tokenUrl = `${base.endsWith("/") ? base : `${base}/`}livekit-token`;

        const response = await fetch(tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.options.idToken}`,
            },
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        return (await response.json()) as LiveKitTokenResponse;
    }

    /**
     * Fetch a token, connect to the LiveKit room, and publish the local
     * microphone. The agent's audio arrives via RoomEvent.TrackSubscribed.
     */
    async connect(): Promise<void> {
        try {
            this.options.onConnectionState?.("connecting");

            const { serverUrl, token } = await this.fetchToken();

            const room = new Room();
            this.room = room;

            room.on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed);
            room.on(RoomEvent.TrackUnsubscribed, this.handleTrackUnsubscribed);
            room.on(RoomEvent.ConnectionStateChanged, (state: LiveKitConnectionState) => {
                this.options.onConnectionState?.(mapConnectionState(state));
            });
            room.on(RoomEvent.Disconnected, () => {
                this.options.onConnectionState?.("disconnected");
            });

            // Text handlers must be registered before connecting: streams that
            // arrive with no handler for their topic are dropped, and the agent
            // greets immediately on join.
            this.registerTextHandlers(room);

            await room.connect(serverUrl, token);
            // Publish the mic — LiveKit handles capture/encoding, so no
            // separate AudioWorklet is needed on this path.
            await room.localParticipant.setMicrophoneEnabled(true);

            this.options.onConnectionState?.("connected");
        } catch (err) {
            const error = err instanceof Error ? err : new Error("LiveKit connection failed");
            this.options.onConnectionState?.("error");
            this.options.onError?.(error);
            throw error;
        }
    }

    /**
     * Subscribe to conversation text and tool activity.
     *
     * Both topics are text streams. A transcription stream is read
     * incrementally so the panel fills in as the sentence is spoken; a tool
     * stream is small and read in one go.
     */
    private registerTextHandlers(room: Room): void {
        room.registerTextStreamHandler(TOPIC_TRANSCRIPTION, (reader, participantInfo) => {
            // The worker publishes each stream under the identity of whoever the
            // text belongs to, so the local identity is what separates the
            // caller's transcription from the agent's own speech.
            const role =
                participantInfo.identity === room.localParticipant.identity ? "user" : "assistant";
            // Falls back to the stream id, which is unique per utterance anyway.
            const segmentId = reader.info.attributes?.["lk.segment_id"] || reader.info.id;

            void (async () => {
                let text = "";
                try {
                    // Each yield is one chunk's decoded text, not the text so
                    // far — the reader's own type doc claims otherwise, which is
                    // wrong: it returns `decoder.decode(chunk.content)`. Taking
                    // it literally showed a single word at a time, each
                    // replacing the last, so accumulate.
                    for await (const chunk of reader) {
                        text += chunk;
                        this.options.onTranscript?.({ segmentId, role, text, isFinal: false });
                    }
                } catch (err) {
                    this.options.onError?.(
                        err instanceof Error ? err : new Error("Transcript stream failed")
                    );
                    return;
                }
                if (text) {
                    this.options.onTranscript?.({ segmentId, role, text, isFinal: true });
                }
            })();
        });

        room.registerTextStreamHandler(TOPIC_TOOL_ACTIVITY, (reader) => {
            void (async () => {
                try {
                    const activity = JSON.parse(await reader.readAll()) as ToolActivity;
                    if (activity?.callId && activity?.name) {
                        this.options.onToolActivity?.(activity);
                    }
                } catch {
                    // Presentational only — a malformed payload must not disturb
                    // the conversation.
                }
            })();
        });
    }

    /**
     * Send typed text to the agent, for the transcript input box and the
     * suggested-prompt cards.
     *
     * Nothing is echoed back on `lk.transcription` for typed input — the agent
     * transcribes speech, not text it was handed — so the caller is responsible
     * for showing what was sent.
     */
    async sendText(text: string): Promise<void> {
        if (!this.room) return;
        try {
            await this.room.localParticipant.sendText(text, { topic: TOPIC_CHAT });
        } catch (err) {
            this.options.onError?.(
                err instanceof Error ? err : new Error("Failed to send message")
            );
        }
    }

    /** Enable/disable the published microphone (mic toggle button). */
    async setMicrophoneEnabled(enabled: boolean): Promise<void> {
        if (!this.room) return;
        try {
            await this.room.localParticipant.setMicrophoneEnabled(enabled);
        } catch (err) {
            this.options.onError?.(
                err instanceof Error ? err : new Error("Failed to toggle microphone")
            );
        }
    }

    /** Tear down the room, audio element, AudioContext, and animation frame. */
    disconnect(): void {
        this.stopAudioAnalysis();
        this.options.onAudioTrack?.(null);

        if (this.audioEl) {
            this.audioEl.pause();
            this.audioEl.srcObject = null;
            this.audioEl.remove();
            this.audioEl = null;
        }

        if (this.room) {
            this.room.removeAllListeners();
            // Text handlers are keyed by topic and are not covered by
            // removeAllListeners, so a reconnect would otherwise fail to
            // register them again ("handler already set for topic").
            this.room.unregisterTextStreamHandler(TOPIC_TRANSCRIPTION);
            this.room.unregisterTextStreamHandler(TOPIC_TOOL_ACTIVITY);
            void this.room.disconnect();
            this.room = null;
        }

        this.options.onSpeakingChange?.(false);
        this.options.onAudioLevel?.(0);
        this.options.onConnectionState?.("disconnected");
    }

    private handleTrackSubscribed = (
        track: RemoteTrack,
        _publication: RemoteTrackPublication,
        _participant: RemoteParticipant
    ): void => {
        if (track.kind !== Track.Kind.Audio) return;

        // Attach for audible playback via a managed <audio> element.
        const el = track.attach() as HTMLAudioElement;
        el.autoplay = true;
        el.style.display = "none";
        document.body.appendChild(el);
        this.audioEl = el;

        // Drive the simple (geometric avatar) mouth from the track's RMS level.
        this.startAudioAnalysis(track.mediaStreamTrack);
        // Hand the raw track to the photorealistic avatar, which does its own
        // MFCC-based viseme classification.
        this.options.onAudioTrack?.(track.mediaStreamTrack);
    };

    private handleTrackUnsubscribed = (track: RemoteTrack): void => {
        if (track.kind !== Track.Kind.Audio) return;
        track.detach().forEach((el) => el.remove());
        this.audioEl = null;
        this.stopAudioAnalysis();
        this.options.onAudioTrack?.(null);
        this.options.onAudioLevel?.(0);
        this.options.onSpeakingChange?.(false);
    };

    private startAudioAnalysis(mediaStreamTrack: MediaStreamTrack): void {
        this.stopAudioAnalysis();

        const audioContext = new AudioContext();
        this.audioContext = audioContext;

        const source = audioContext.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
        this.sourceNode = source;

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        this.analyser = analyser;
        source.connect(analyser);

        const buffer = new Float32Array(analyser.fftSize);

        const tick = (): void => {
            if (!this.analyser) return;
            this.analyser.getFloatTimeDomainData(buffer);

            let sumSquares = 0;
            for (let i = 0; i < buffer.length; i++) {
                sumSquares += buffer[i] * buffer[i];
            }
            const rms = Math.sqrt(sumSquares / buffer.length);
            // Amplify and clamp so quiet speech still moves the mouth.
            const level = Math.min(1, rms * 4);

            this.options.onAudioLevel?.(level);

            const speaking = rms > SPEAKING_RMS_THRESHOLD;
            if (speaking !== this.wasSpeaking) {
                this.wasSpeaking = speaking;
                this.options.onSpeakingChange?.(speaking);
            }

            this.rafId = requestAnimationFrame(tick);
        };

        this.rafId = requestAnimationFrame(tick);
    }

    private stopAudioAnalysis(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }
        this.analyser = null;
        if (this.audioContext && this.audioContext.state !== "closed") {
            void this.audioContext.close();
        }
        this.audioContext = null;
        this.wasSpeaking = false;
    }
}
