import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Text-to-speech via the browser Web Speech API (`speechSynthesis`).
 *
 * Self-contained — no backend or AWS call — which keeps the demo deploy-only.
 * Used by the AI Assistant's Catalog Studio to read service descriptions and a
 * spoken account/investment progress summary aloud.
 */

export interface UseSpeechResult {
    /** True when the browser supports speech synthesis. */
    supported: boolean;
    /** True while an utterance is being spoken. */
    speaking: boolean;
    /** The id currently being spoken (caller-supplied), or null. */
    activeId: string | null;
    /** Speak the given text. Cancels any in-progress utterance first. */
    speak: (text: string, id?: string) => void;
    /** Stop any in-progress utterance. */
    stop: () => void;
}

export function useSpeech(): UseSpeechResult {
    const supported = typeof window !== "undefined" && "speechSynthesis" in window;
    const [speaking, setSpeaking] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);
    const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

    const stop = useCallback(() => {
        if (!supported) return;
        window.speechSynthesis.cancel();
        setSpeaking(false);
        setActiveId(null);
    }, [supported]);

    const speak = useCallback(
        (text: string, id?: string) => {
            if (!supported || !text.trim()) return;
            // Cancel any current utterance so presses don't queue up.
            window.speechSynthesis.cancel();

            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1;
            utterance.pitch = 1;
            utterance.onend = () => {
                setSpeaking(false);
                setActiveId(null);
            };
            utterance.onerror = () => {
                setSpeaking(false);
                setActiveId(null);
            };
            utteranceRef.current = utterance;
            setSpeaking(true);
            setActiveId(id ?? null);
            window.speechSynthesis.speak(utterance);
        },
        [supported]
    );

    // Stop speech if the component using the hook unmounts.
    useEffect(() => {
        return () => {
            if (supported) window.speechSynthesis.cancel();
        };
    }, [supported]);

    return { supported, speaking, activeId, speak, stop };
}
