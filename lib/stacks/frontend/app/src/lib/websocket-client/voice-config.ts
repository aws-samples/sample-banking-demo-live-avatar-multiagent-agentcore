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
 * entry in VOICES". The implicit version silently defaulted en-US to Tiffany,
 * which no longer matches the avatar and made the selector look wrong.
 *
 * en-US must stay in step with `context.livekit.voiceId` in cdk.json: the
 * LiveKit worker holds one voice for the life of the task and cannot be changed
 * from the UI, so a mismatch here shows the wrong voice as selected.
 */
const DEFAULT_VOICE_BY_LANGUAGE: Record<LanguageCode, string> = {
    "en-US": "matthew",
    "es-US": "pedro",
    "fr-FR": "remi",
    "it-IT": "bianca",
    "de-DE": "hans",
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
