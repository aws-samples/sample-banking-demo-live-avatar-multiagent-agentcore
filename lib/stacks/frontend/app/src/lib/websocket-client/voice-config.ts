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

/**
 * Voices Nova Sonic 2 (`amazon.nova-2-sonic-v1:0`) actually accepts.
 *
 * Every id here is checked against SONIC2_VOICES in the AWS realtime plugin
 * (`livekit/plugins/aws/experimental/realtime/types.py`). The list previously
 * held ids from a different TTS catalogue — Pedro, Léa, Rémi, Bianca, Hans,
 * Vicki and Vitória are not Nova Sonic voices, and four of them were the
 * defaults for Spanish, French, German and Portuguese, so picking any language
 * other than English sent the model a voice it does not have.
 *
 * Only add an id after confirming it appears in SONIC2_VOICES.
 */
export const VOICES: VoiceProfile[] = [
    { id: "tiffany", name: "Tiffany", language: "en-US", gender: "female" },
    { id: "matthew", name: "Matthew", language: "en-US", gender: "male" },
    { id: "lupe", name: "Lupe", language: "es-US", gender: "female" },
    { id: "carlos", name: "Carlos", language: "es-US", gender: "male" },
    { id: "ambre", name: "Ambre", language: "fr-FR", gender: "female" },
    { id: "florian", name: "Florian", language: "fr-FR", gender: "male" },
    { id: "beatrice", name: "Beatrice", language: "it-IT", gender: "female" },
    { id: "lorenzo", name: "Lorenzo", language: "it-IT", gender: "male" },
    { id: "tina", name: "Tina", language: "de-DE", gender: "female" },
    { id: "lennart", name: "Lennart", language: "de-DE", gender: "male" },
    { id: "carolina", name: "Carolina", language: "pt-BR", gender: "female" },
    { id: "leo", name: "Leo", language: "pt-BR", gender: "male" },
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
    "fr-FR": "ambre",
    "it-IT": "beatrice",
    "de-DE": "tina",
    "pt-BR": "carolina",
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
 * default when it has no voice of that gender.
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
