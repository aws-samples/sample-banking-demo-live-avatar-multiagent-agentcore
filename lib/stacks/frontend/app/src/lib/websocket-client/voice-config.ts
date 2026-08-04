export type LanguageCode = "en-US" | "es-US" | "fr-FR" | "it-IT" | "de-DE" | "pt-BR";

export interface VoiceProfile {
    id: string;
    name: string;
    language: LanguageCode;
    gender: "female" | "male";
}

export interface LanguageOption {
    code: LanguageCode;
    label: string;
    flag: string;
}

export const LANGUAGES: LanguageOption[] = [
    { code: "en-US", label: "English (US)", flag: "🇺🇸" },
    { code: "es-US", label: "Spanish (US)", flag: "🇪🇸" },
    { code: "fr-FR", label: "French", flag: "🇫🇷" },
    { code: "it-IT", label: "Italian", flag: "🇮🇹" },
    { code: "de-DE", label: "German", flag: "🇩🇪" },
    { code: "pt-BR", label: "Portuguese (BR)", flag: "🇧🇷" },
];

export const VOICES: VoiceProfile[] = [
    { id: "tiffany", name: "Tiffany", language: "en-US", gender: "female" },
    { id: "matthew", name: "Matthew", language: "en-US", gender: "male" },
    { id: "amy", name: "Amy", language: "en-US", gender: "female" },
    { id: "lupe", name: "Lupe", language: "es-US", gender: "female" },
    { id: "pedro", name: "Pedro", language: "es-US", gender: "male" },
    { id: "lea", name: "Léa", language: "fr-FR", gender: "female" },
    { id: "remi", name: "Rémi", language: "fr-FR", gender: "male" },
    { id: "bianca", name: "Bianca", language: "it-IT", gender: "female" },
    { id: "hans", name: "Hans", language: "de-DE", gender: "male" },
    { id: "vicki", name: "Vicki", language: "de-DE", gender: "female" },
    { id: "vitoria", name: "Vitória", language: "pt-BR", gender: "female" },
];

/**
 * Default voice per language, stated explicitly rather than taken as "first
 * entry in VOICES", which defaulted silently and made the selector look wrong.
 *
 * Defaults are female because the default avatar — "Advisor", the rigged GLB —
 * is female. Selecting a different avatar overrides this: see
 * `getVoiceForGender`, which `AvatarInterface` uses to keep voice and avatar in
 * step.
 *
 * en-US must stay in step with `context.livekit.voiceId` in cdk.json. The
 * LiveKit worker holds one voice for the life of the task and cannot be changed
 * from the UI, so on that transport this is the voice you get regardless of the
 * avatar shown.
 */
const DEFAULT_VOICE_BY_LANGUAGE: Record<LanguageCode, string> = {
    "en-US": "tiffany",
    "es-US": "lupe",
    "fr-FR": "lea",
    "it-IT": "bianca",
    "de-DE": "vicki",
    "pt-BR": "vitoria",
};

export function getVoicesForLanguage(language: LanguageCode): VoiceProfile[] {
    return VOICES.filter((v) => v.language === language);
}

export function getDefaultVoice(language: LanguageCode): VoiceProfile {
    const voices = getVoicesForLanguage(language);
    const preferred = voices.find((v) => v.id === DEFAULT_VOICE_BY_LANGUAGE[language]);
    return preferred ?? voices[0] ?? VOICES[0];
}

/**
 * Best voice of a given gender for a language, falling back to that language's
 * default when it has no voice of that gender (Italian and Portuguese are
 * female-only in the list above).
 *
 * Used to match the voice to the avatar on screen: a female GLB with a male
 * voice reads as a bug, which is exactly what happened when the default was
 * changed to Matthew while the default avatar stayed female.
 */
export function getVoiceForGender(
    language: LanguageCode,
    gender: VoiceProfile["gender"]
): VoiceProfile {
    const match = getVoicesForLanguage(language).find((v) => v.gender === gender);
    return match ?? getDefaultVoice(language);
}
