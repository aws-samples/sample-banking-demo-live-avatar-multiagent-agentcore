/**
 * Viseme shape the avatar should render. Derived from a lightweight PCM
 * analyser in `lipSyncAnalyzer.ts`, set on every audio chunk so the mouth
 * style tracks what the model is actually saying.
 */
export type MouthShape =
    | "open"
    | "ah"
    | "oh"
    | "ee"
    | "oo"
    | "wide"
    | "narrow"
    | "mm"
    | "ff"
    | "th"
    | "neutral";

export interface AvatarVariant {
    resize(width: number, height: number): void;
    updateLipSync(audioLevel: number): void;
    setSpeaking(isSpeaking: boolean): void;
    setEyeColor(hexColor: number): void;
    /** Optional: variants that map visemes to blend-shapes / physical deforms implement this. */
    setMouthShape?(shape: MouthShape): void;
    /**
     * Optional: variants that can derive their own visemes from the raw agent
     * audio implement this. Preferred over `updateLipSync` where available,
     * because it bypasses React state and yields real visemes rather than a
     * loudness value. Only the LiveKit transport supplies a track.
     */
    setAudioTrack?(track: MediaStreamTrack | null): void | Promise<void>;
    dispose(): void;
}

/**
 * `realistic` is not a canvas variant like the others — it renders the rigged
 * TalkingHead GLB (see TalkingHeadAvatar.tsx), which manages its own scene and
 * lip-sync, so it is branched at the AvatarInterface level rather than
 * constructed through `createAvatar`. It is labelled "Advisor" in the picker.
 *
 * `photo` is the "Realistic" picker entry: a real photograph warped per viseme
 * (see Avatar3DPhoto.ts). It goes through `createAvatar` like the generated
 * variants, because it is a normal three.js scene.
 */
export type AvatarVariantName = "realistic" | "photo" | "robot" | "blob" | "crystal";
