import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "react-oidc-context";
import { synthesizeSpeech, pollyConfigured } from "@/services/pollySpeech";

/**
 * Text-to-speech via Amazon Polly's generative voice.
 *
 * Used by the AI Assistant's catalog review to read service descriptions and a
 * spoken account/investment progress summary aloud. Previously backed by the
 * browser Web Speech API, which sounded robotic and differed per OS/browser;
 * Polly's generative engine gives one natural, consistent voice everywhere.
 *
 * The public shape is unchanged from the Web Speech version, so callers did not
 * change — but `speak` now kicks off an async synth + playback under the hood.
 */

export interface UseSpeechResult {
    /** True when Polly speech is available (Identity Pool configured + signed in). */
    supported: boolean;
    /** True while audio is being synthesized or played. */
    speaking: boolean;
    /** The id currently being spoken (caller-supplied), or null. */
    activeId: string | null;
    /** Speak the given text. Cancels any in-progress utterance first. */
    speak: (text: string, id?: string) => void;
    /** Stop any in-progress utterance. */
    stop: () => void;
}

export function useSpeech(): UseSpeechResult {
    const auth = useAuth();
    const idToken = auth.user?.id_token;
    const supported = pollyConfigured() && !!idToken;

    const [speaking, setSpeaking] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const urlRef = useRef<string | null>(null);
    // Bumped on every speak/stop so a slow synth that resolves after the user
    // moved on cannot start playing over the top of a newer request.
    const seqRef = useRef(0);

    const teardownAudio = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = "";
            audioRef.current = null;
        }
        if (urlRef.current) {
            URL.revokeObjectURL(urlRef.current);
            urlRef.current = null;
        }
    }, []);

    const stop = useCallback(() => {
        seqRef.current += 1; // invalidate any in-flight synth
        teardownAudio();
        setSpeaking(false);
        setActiveId(null);
    }, [teardownAudio]);

    const speak = useCallback(
        (text: string, id?: string) => {
            if (!supported || !idToken || !text.trim()) return;

            // Supersede anything in progress.
            seqRef.current += 1;
            const mySeq = seqRef.current;
            teardownAudio();

            // Optimistically reflect activity so the button flips to "Stop"
            // during synthesis; state is set from this event handler, never
            // synchronously inside an effect.
            setSpeaking(true);
            setActiveId(id ?? null);

            void synthesizeSpeech(text, {
                idToken,
                identityPoolId: import.meta.env.VITE_IDENTITY_POOL_ID,
                userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
                region: import.meta.env.VITE_REGION || "us-east-1",
            })
                .then((blob) => {
                    // A newer speak() or a stop() ran while we were synthesizing.
                    if (mySeq !== seqRef.current) return;
                    const url = URL.createObjectURL(blob);
                    urlRef.current = url;
                    const audio = new Audio(url);
                    audioRef.current = audio;
                    const clear = (): void => {
                        if (mySeq !== seqRef.current) return;
                        teardownAudio();
                        setSpeaking(false);
                        setActiveId(null);
                    };
                    audio.onended = clear;
                    audio.onerror = clear;
                    void audio.play().catch(clear);
                })
                .catch((err) => {
                    if (mySeq !== seqRef.current) return;
                    console.error("Polly synthesis failed:", err);
                    setSpeaking(false);
                    setActiveId(null);
                });
        },
        [supported, idToken, teardownAudio]
    );

    // Stop playback if the component using the hook unmounts.
    useEffect(() => {
        return () => {
            seqRef.current += 1;
            teardownAudio();
        };
    }, [teardownAudio]);

    return { supported, speaking, activeId, speak, stop };
}
