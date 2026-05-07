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
    dispose(): void;
}

export type AvatarVariantName = "robot" | "blob" | "crystal";
