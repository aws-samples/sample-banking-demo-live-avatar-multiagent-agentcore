export type QualityTier = "low" | "medium" | "high";

export interface AvatarVariant {
    resize(width: number, height: number): void;
    updateLipSync(audioLevel: number): void;
    setSpeaking(isSpeaking: boolean): void;
    setEyeColor(hexColor: number): void;
    /** Optional: variants that support rendering-quality switching implement this. */
    setQuality?(tier: QualityTier): void;
    dispose(): void;
}

export type AvatarVariantName = "robot" | "blob" | "crystal";
