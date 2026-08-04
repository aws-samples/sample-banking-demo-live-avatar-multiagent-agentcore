/**
 * Photorealistic talking-head avatar for the Relationship Manager.
 *
 * Renders a rigged human GLB via TalkingHead (MIT) and lip-syncs it from the
 * live Nova Sonic 2 audio that LiveKit delivers as a MediaStreamTrack, using
 * HeadAudio (MIT) for audio-driven viseme detection.
 *
 * Why audio-driven: Nova Sonic streams speech audio, not word-level timestamps,
 * so TalkingHead's text-driven lip-sync path doesn't apply. HeadAudio classifies
 * Oculus visemes straight from the audio signal (MFCC + Mahalanobis), needing no
 * transcript or timing data.
 *
 * Playback note: LiveKit already plays the remote track through its own <audio>
 * element. HeadAudio has an input but produces no audio output, so tapping the
 * same track here drives the mouth without double-playing the voice.
 *
 * Assets are self-hosted under /public (no third-party CDN at runtime):
 *   /avatars/trinity-advisor.glb  - CC0 avatar (MPFB), meshopt + webp compressed
 *   /headaudio/headworklet.min.mjs, /headaudio/model-en-mixed.bin
 */

import { useEffect, useRef, useState } from "react";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { TalkingHead } from "@met4citizen/talkinghead";
import { HeadAudio } from "@met4citizen/headaudio/modules/headaudio.mjs";

const AVATAR_URL = "/avatars/trinity-advisor.glb";
const WORKLET_URL = "/headaudio/headworklet.min.mjs";
const VISEME_MODEL_URL = "/headaudio/model-en-mixed.bin";

/**
 * Make TalkingHead's internal GLTFLoader meshopt-capable.
 *
 * TalkingHead only wires a Draco decoder, but Draco compresses this avatar's 66
 * morph targets very poorly (16.4 MB vs 3.7 MB with meshopt). TalkingHead imports
 * GLTFLoader from the same `three/addons` path we do, so the class object is
 * shared and we can attach the decoder without forking the library.
 *
 * A plain `prototype.meshoptDecoder = ...` is not enough: GLTFLoader's constructor
 * assigns `this.meshoptDecoder = null`, creating an own property that shadows the
 * prototype. An accessor with a no-op setter absorbs that assignment and always
 * reports the decoder. Requires `resolve.dedupe: ["three"]` in vite.config.ts so
 * only one copy of three exists.
 */
let meshoptPatched = false;
function ensureMeshoptDecoder(): void {
    if (meshoptPatched) return;
    Object.defineProperty(GLTFLoader.prototype, "meshoptDecoder", {
        get: () => MeshoptDecoder,
        set: () => {},
        configurable: true,
    });
    meshoptPatched = true;
}

export interface TalkingHeadAvatarProps {
    /** Remote agent audio from LiveKit. Lip-sync is driven from this track. */
    audioTrack?: MediaStreamTrack | null;
    /** Fallback mouth drive (0..1) for transports that expose only a level. */
    audioLevel?: number;
    isSpeaking?: boolean;
    className?: string;
}

export default function TalkingHeadAvatar({
    audioTrack = null,
    audioLevel = 0,
    isSpeaking = false,
    className,
}: TalkingHeadAvatarProps): JSX.Element {
    const containerRef = useRef<HTMLDivElement>(null);
    const headRef = useRef<InstanceType<typeof TalkingHead> | null>(null);
    const headAudioRef = useRef<InstanceType<typeof HeadAudio> | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [errorMsg, setErrorMsg] = useState<string>("");

    // ── Create the avatar once ────────────────────────────────────────
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let disposed = false;
        let head: InstanceType<typeof TalkingHead> | null = null;

        (async () => {
            try {
                ensureMeshoptDecoder();

                head = new TalkingHead(container, {
                    // No TTS is used — lip-sync is audio-driven. The endpoint is
                    // never called; it only satisfies the constructor.
                    ttsEndpoint: "/unused-tts",
                    lipsyncModules: [],
                    cameraView: "head",
                    cameraRotateEnable: false,
                    cameraPanEnable: false,
                    cameraZoomEnable: false,
                    modelFPS: 30,
                });

                await head.showAvatar({
                    url: AVATAR_URL,
                    body: "F",
                    avatarMood: "neutral",
                });
                if (disposed) {
                    head.stop();
                    return;
                }
                headRef.current = head;

                // Audio-driven viseme detection.
                await head.audioCtx.audioWorklet.addModule(WORKLET_URL);
                const headaudio = new HeadAudio(head.audioCtx, {
                    parameterData: { vadGateActiveDb: -45, vadGateInactiveDb: -65 },
                });
                await headaudio.loadModel(VISEME_MODEL_URL);
                if (disposed) {
                    head.stop();
                    return;
                }

                const localHead = head;
                headaudio.onvalue = (key: string, value: number) => {
                    const mt = localHead.mtAvatar[key];
                    if (mt) Object.assign(mt, { newvalue: value, needsUpdate: true });
                };
                // Advance HeadAudio's easing/blending from the render loop.
                localHead.opt.update = headaudio.update.bind(headaudio);
                headAudioRef.current = headaudio;

                // Small human touch: re-establish eye contact each new utterance.
                headaudio.onstarted = () => localHead.lookAtCamera(600);

                setStatus("ready");
            } catch (err) {
                if (disposed) return;
                const msg = err instanceof Error ? err.message : String(err);
                // eslint-disable-next-line no-console
                console.error("[TalkingHeadAvatar] init failed:", err);
                setErrorMsg(msg);
                setStatus("error");
            }
        })();

        return () => {
            disposed = true;
            try {
                sourceRef.current?.disconnect();
            } catch {
                /* already torn down */
            }
            sourceRef.current = null;
            headAudioRef.current = null;
            headRef.current = null;
            try {
                head?.stop();
            } catch {
                /* already stopped */
            }
            container.replaceChildren();
        };
    }, []);

    // ── Attach the LiveKit audio track to HeadAudio ────────────────────
    useEffect(() => {
        const head = headRef.current;
        const headaudio = headAudioRef.current;
        if (status !== "ready" || !head || !headaudio) return;

        // Drop any previous track's graph before wiring the new one.
        if (sourceRef.current) {
            try {
                sourceRef.current.disconnect();
            } catch {
                /* noop */
            }
            sourceRef.current = null;
        }
        if (!audioTrack) return;

        // Autoplay policies can leave the context suspended until a gesture;
        // the user has clicked "Connect" by this point, so resume is allowed.
        void head.audioCtx.resume();

        const src = head.audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
        // HeadAudio consumes audio and emits visemes; it intentionally has no
        // audio output, so this tap cannot double-play the agent's voice.
        src.connect(headaudio);
        sourceRef.current = src;

        return () => {
            try {
                src.disconnect();
            } catch {
                /* noop */
            }
            if (sourceRef.current === src) sourceRef.current = null;
        };
    }, [audioTrack, status]);

    // ── Fallback jaw drive when no track is available ──────────────────
    // Used by the legacy WebSocket transport, which exposes only an RMS level.
    useEffect(() => {
        if (status !== "ready" || audioTrack) return;
        const head = headRef.current;
        if (!head) return;
        const jaw = head.mtAvatar["jawOpen"];
        if (jaw) {
            Object.assign(jaw, {
                newvalue: isSpeaking ? Math.min(1, Math.max(0, audioLevel)) * 0.7 : 0,
                needsUpdate: true,
            });
        }
    }, [audioLevel, isSpeaking, audioTrack, status]);

    return (
        <div className={className} style={{ width: "100%", height: "100%", position: "relative" }}>
            <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
            {status !== "ready" && (
                <div
                    className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 pointer-events-none"
                    style={{ color: "var(--app-text-secondary)" }}
                >
                    {status === "loading" ? (
                        <>
                            <div className="text-sm font-medium">Loading advisor…</div>
                            <div className="text-xs opacity-70">Preparing the 3D model</div>
                        </>
                    ) : (
                        <>
                            <div className="text-sm font-medium">3D advisor unavailable</div>
                            <div className="text-xs opacity-70 max-w-xs">
                                {errorMsg.includes("WebGL") || errorMsg.includes("context")
                                    ? "This browser has WebGL disabled — enable hardware acceleration to show the avatar. Voice is unaffected."
                                    : errorMsg}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
