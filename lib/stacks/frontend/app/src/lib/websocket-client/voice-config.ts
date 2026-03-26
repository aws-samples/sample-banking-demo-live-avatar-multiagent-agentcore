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

export function getVoicesForLanguage(language: LanguageCode): VoiceProfile[] {
    return VOICES.filter((v) => v.language === language);
}

export function getDefaultVoice(language: LanguageCode): VoiceProfile {
    const voices = getVoicesForLanguage(language);
    return voices[0] ?? VOICES[0];
}
