export interface AvatarVariant {
    resize(width: number, height: number): void;
    updateLipSync(audioLevel: number): void;
    setSpeaking(isSpeaking: boolean): void;
    setEyeColor(hexColor: number): void;
    dispose(): void;
}

export type AvatarVariantName = "robot" | "blob" | "crystal";
