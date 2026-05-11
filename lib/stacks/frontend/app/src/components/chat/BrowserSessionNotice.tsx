import { useState, useCallback } from "react";
import { X } from "lucide-react";

const DISMISS_KEY = "browser-session-notice-dismissed-v1";

interface BrowserSessionNoticeProps {
    message: string;
}

/**
 * One-shot notice rendered inline in the chat when the concierge first
 * spins up a browser microVM. Explains the per-turn session lifecycle —
 * each chat turn gets a fresh microVM that terminates when the turn ends,
 * so multi-step flows (like a reservation booking) need to be completed
 * in a single user message.
 *
 * Dismissal is persisted to localStorage so returning users don't see it
 * again. When already dismissed, the component renders nothing — the
 * browser live view sidebar still opens via the BrowserLiveView event.
 */
export function BrowserSessionNotice({ message }: BrowserSessionNoticeProps): JSX.Element | null {
    const [dismissed, setDismissed] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        return window.localStorage.getItem(DISMISS_KEY) === "true";
    });

    const handleDismiss = useCallback(() => {
        try {
            window.localStorage.setItem(DISMISS_KEY, "true");
        } catch {
            // Private browsing / quota-exceeded — dismiss for the session only.
        }
        setDismissed(true);
    }, []);

    if (dismissed) {
        return null;
    }

    return (
        <div
            role="note"
            aria-label="Browser session notice"
            className="my-2 flex items-start gap-3 rounded-lg border px-3 py-2 text-sm"
            style={{
                borderColor: "rgba(255, 153, 0, 0.4)",
                background: "rgba(255, 153, 0, 0.08)",
                color: "var(--app-text-primary)",
            }}
        >
            <span className="grow leading-relaxed">{message}</span>
            <button
                type="button"
                onClick={handleDismiss}
                aria-label="Dismiss browser session notice"
                className="rounded p-0.5 transition-colors hover:bg-black/10"
                style={{ color: "var(--app-text-secondary)" }}
            >
                <X size={14} />
            </button>
        </div>
    );
}
