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
 * Two variants are branched at the AvatarInterface level rather than built
 * through `createAvatar`, because they are not three.js canvas scenes:
 *
 * - `realistic` renders the rigged TalkingHead GLB (see TalkingHeadAvatar.tsx),
 *   which manages its own scene and lip-sync. Labelled "Advisor" in the picker.
 * - `tavus` renders a server-produced photoreal video track over WebRTC (see
 *   TavusAvatar.tsx). Labelled "Realistic" in the picker. It has no local
 *   rendering — the avatar is rendered by Tavus and streamed in.
 *
 * `robot`, `blob`, and `crystal` are ordinary three.js scenes built through
 * `createAvatar` in Avatar3DReactWrapper.
 */
export type AvatarVariantName = "realistic" | "tavus" | "robot" | "blob" | "crystal";

/**
 * Apparent gender of each avatar, used to keep the selected voice matching the
 * face on screen. `null` means the variant has no apparent gender, so the
 * language default stands.
 *
 * "Advisor" (`realistic`) is the rigged female GLB. `tavus` is `null`: the Tavus
 * replica's voice and appearance are fixed server-side by the chosen replica id,
 * and the client voice selector does not reach that transport, so there is no
 * client-side voice to match.
 */
export const VARIANT_VOICE_GENDER: Record<AvatarVariantName, "female" | "male" | null> = {
    realistic: "female",
    tavus: null,
    robot: null,
    blob: null,
    crystal: null,
};
