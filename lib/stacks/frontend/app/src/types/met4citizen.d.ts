/**
 * Minimal ambient types for the met4citizen avatar libraries (both MIT, neither
 * ships TypeScript definitions). Only the surface the Relationship Manager
 * actually uses is declared — kept deliberately narrow so a library change
 * surfaces as a compile error rather than silently drifting.
 */

declare module "@met4citizen/talkinghead" {
    /** A single blend shape (morph target) slot on the loaded avatar. */
    export interface MorphTarget {
        newvalue?: number;
        needsUpdate?: boolean;
        [key: string]: unknown;
    }

    export interface TalkingHeadOptions {
        ttsEndpoint?: string;
        lipsyncModules?: string[];
        cameraView?: "full" | "mid" | "upper" | "head";
        cameraRotateEnable?: boolean;
        cameraPanEnable?: boolean;
        cameraZoomEnable?: boolean;
        modelFPS?: number;
        modelPixelRatio?: number;
        lightAmbientIntensity?: number;
        lightDirectIntensity?: number;
        avatarMood?: string;
        /** Called each animation frame with the frame delta in ms. */
        update?: ((deltaMs: number) => void) | null;
        [key: string]: unknown;
    }

    export interface ShowAvatarOptions {
        url: string;
        body?: "M" | "F";
        avatarMood?: string;
        lipsyncLang?: string;
        baseline?: Record<string, number>;
        [key: string]: unknown;
    }

    export class TalkingHead {
        constructor(node: HTMLElement, opts?: TalkingHeadOptions);
        readonly audioCtx: AudioContext;
        /** Blend-shape map, keyed by ARKit / Oculus viseme name. */
        readonly mtAvatar: Record<string, MorphTarget>;
        opt: TalkingHeadOptions;
        showAvatar(
            avatar: ShowAvatarOptions,
            onprogress?: (e: ProgressEvent) => void
        ): Promise<void>;
        setView(view: "full" | "mid" | "upper" | "head", opt?: Record<string, number>): void;
        setMood(mood: string): void;
        lookAtCamera(durationMs: number): void;
        makeEyeContact(durationMs: number): void;
        start(): void;
        stop(): void;
    }
}

declare module "@met4citizen/headaudio/modules/headaudio.mjs" {
    export interface HeadAudioOptions {
        processorOptions?: Record<string, unknown>;
        parameterData?: Record<string, number>;
    }

    /** AudioWorkletNode that emits Oculus viseme values from an audio stream. */
    export class HeadAudio extends AudioWorkletNode {
        constructor(ctx: BaseAudioContext, opts?: HeadAudioOptions);
        loadModel(url: string): Promise<void>;
        update(deltaMs: number): void;
        onvalue: ((key: string, value: number) => void) | null;
        onstarted: ((data: unknown) => void) | null;
        onended: ((data: unknown) => void) | null;
    }
}
