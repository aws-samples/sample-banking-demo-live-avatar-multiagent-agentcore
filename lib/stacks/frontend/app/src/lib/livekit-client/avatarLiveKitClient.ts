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
