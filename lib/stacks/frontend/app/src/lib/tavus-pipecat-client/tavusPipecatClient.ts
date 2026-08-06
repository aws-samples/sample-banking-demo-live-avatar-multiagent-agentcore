/**
 * Daily transport client for the Tavus video-avatar path.
 *
 * Parallel to `../livekit-client/avatarLiveKitClient.ts`, and deliberately
 * mirrors its callback surface so `AvatarInterface` can branch between the two
 * transports symmetrically. The difference is that here the agent's face is a
 * server-rendered **video** track (Tavus), surfaced via `onVideoTrack`, rather
 * than an audio track that drives a local WebGL avatar.
 *
 * Flow:
 *  1. connect() POSTs to the Cognito-authorized offer endpoint
 *     (`${VITE_TAVUS_OFFER_URL}tavus-offer`) with `Authorization: Bearer
 *     <id_token>`. The endpoint injects the verified caller identity and starts
 *     a worker session, returning a Daily room URL + short-lived token.
 *  2. We join that Daily room with daily-js. The Pipecat worker is already in
 *     the room; its audio + video tracks arrive via `track-started`.
 *  3. Data-channel `app-message`s (`{type:"transcript"}` / `{type:"tool"}`) are
 *     mapped onto the same `TranscriptUpdate` / `ToolActivity` callbacks the
 *     LiveKit path produces, so the transcript panel and tool cards are reused.
 *
 * Only an ephemeral Daily room token reaches the browser; the Tavus and Daily
 * API keys stay in the worker's task environment.
 */

import Daily, { type DailyCall, type DailyEventObjectAppMessage } from "@daily-co/daily-js";
import type {
    AvatarConnectionState,
    ToolActivity,
    TranscriptUpdate,
} from "../livekit-client/avatarLiveKitClient";
import { mapWorkerMessage, parseWorkerMessage } from "./tavusMessages";

export interface TavusPipecatOptions {
    /** Cognito ID token (auth.user.id_token) — same token feedbackService sends. */
    idToken: string;
    /**
     * Nova Sonic voice id chosen in the picker. Sent in the offer so the worker
     * uses it for speech and picks the matching Tavus avatar face (e.g. the male
     * voice "matthew" → Raj). Voice is chosen before connecting (the selector is
     * disabled while connected), so it is fixed for the session.
     */
    voiceId?: string;
    /** The agent's remote avatar video track (or null when it goes away). */
    onVideoTrack?: (track: MediaStreamTrack | null) => void;
    /** Fires when the agent starts/stops speaking, for a speaking indicator. */
    onSpeakingChange?: (isSpeaking: boolean) => void;
    /** Connection lifecycle updates. */
    onConnectionState?: (state: AvatarConnectionState) => void;
    /** Conversation text as it is spoken, for the transcript panel. */
    onTranscript?: (update: TranscriptUpdate) => void;
    /** Tool calls starting and finishing, for tool cards and result artifacts. */
    onToolActivity?: (activity: ToolActivity) => void;
    /** Non-fatal and fatal errors. */
    onError?: (error: Error) => void;
}

interface WorkerStartResponse {
    dailyRoom?: string;
    dailyToken?: string;
    room_url?: string;
    token?: string;
}

export class TavusPipecatClient {
    private readonly options: TavusPipecatOptions;
    private call: DailyCall | null = null;
    private audioEl: HTMLAudioElement | null = null;
    private signalledConnected = false;

    constructor(options: TavusPipecatOptions) {
        this.options = options;
    }

    private offerUrl(): string {
        const base = import.meta.env.VITE_TAVUS_OFFER_URL;
        if (!base) throw new Error("VITE_TAVUS_OFFER_URL is not configured");
        // Mirrors avatarLiveKitClient: the env var is the API Gateway stage root
        // (ends with "/"), so the resource path must be appended.
        return `${base.endsWith("/") ? base : `${base}/`}tavus-offer`;
    }

    /** Start a worker session and join the returned Daily room. */
    async connect(): Promise<void> {
        try {
            this.options.onConnectionState?.("connecting");

            const response = await fetch(this.offerUrl(), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.options.idToken}`,
                },
                body: JSON.stringify({
                    requestData: this.options.voiceId ? { voiceId: this.options.voiceId } : {},
                }),
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${response.status}`);
            }
            const data = (await response.json()) as WorkerStartResponse;
            const roomUrl = data.dailyRoom || data.room_url;
            const token = data.dailyToken || data.token;
            if (!roomUrl) throw new Error("No Daily room returned from the offer endpoint");

            const call = Daily.createCallObject({ videoSource: false, audioSource: true });
            this.call = call;

            call.on("track-started", this.handleTrackStarted);
            call.on("app-message", this.handleAppMessage);
            call.on("left-meeting", () => this.options.onConnectionState?.("disconnected"));
            call.on("error", (ev) =>
                this.options.onError?.(new Error(ev?.errorMsg || "Daily error"))
            );

            await call.join({ url: roomUrl, token: token || undefined });
            // "connected" is fired on the first remote video track (see
            // handleTrackStarted), not here, so the UI waits for a real avatar.
        } catch (err) {
            const error = err instanceof Error ? err : new Error("Tavus connection failed");
            this.options.onConnectionState?.("error");
            this.options.onError?.(error);
            throw error;
        }
    }

    /** Enable/disable the published microphone (mic toggle button). */
    setMicrophoneEnabled(enabled: boolean): void {
        this.call?.setLocalAudio(enabled);
    }

    /** Tear down the Daily call and audio element. Idempotent. */
    disconnect(): void {
        if (this.audioEl) {
            this.audioEl.pause();
            this.audioEl.srcObject = null;
            this.audioEl.remove();
            this.audioEl = null;
        }
        if (this.call) {
            const call = this.call;
            this.call = null;
            try {
                call.leave();
                call.destroy();
            } catch {
                /* already torn down */
            }
        }
        this.signalledConnected = false;
        this.options.onVideoTrack?.(null);
        this.options.onSpeakingChange?.(false);
        this.options.onConnectionState?.("disconnected");
    }

    private handleTrackStarted = (ev: unknown): void => {
        const event = ev as {
            participant?: { local?: boolean };
            track?: MediaStreamTrack;
        };
        const { participant, track } = event;
        if (!track || participant?.local) return;

        if (track.kind === "video") {
            this.options.onVideoTrack?.(track);
            if (!this.signalledConnected) {
                this.signalledConnected = true;
                this.options.onConnectionState?.("connected");
            }
        } else if (track.kind === "audio") {
            // daily-js createCallObject does not auto-play remote audio; attach
            // it to a hidden <audio> element, mirroring avatarLiveKitClient.
            const el = document.createElement("audio");
            el.autoplay = true;
            el.style.display = "none";
            el.srcObject = new MediaStream([track]);
            document.body.appendChild(el);
            this.audioEl = el;
        }
    };

    private handleAppMessage = (ev: DailyEventObjectAppMessage): void => {
        const msg = parseWorkerMessage(ev?.data);
        if (!msg) return;
        const mapped = mapWorkerMessage(msg);
        if (mapped.kind === "transcript") {
            this.options.onTranscript?.(mapped.update);
            if (mapped.agentSpeaking !== null) {
                this.options.onSpeakingChange?.(mapped.agentSpeaking);
            }
        } else if (mapped.kind === "tool") {
            this.options.onToolActivity?.(mapped.activity);
        }
    };
}
