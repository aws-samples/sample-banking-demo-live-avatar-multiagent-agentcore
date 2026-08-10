import { useCallback, useEffect, useState } from "react";
import { useAuth } from "react-oidc-context";
import { fetchFeedbackSummary, type FeedbackSummary } from "@/services/feedbackSummaryService";

/** Steady refresh so the loop reflects signals submitted during a session. */
const POLL_MS = 15000;

export interface UseFeedbackSummaryResult {
    summary: FeedbackSummary | null;
    loading: boolean;
    refresh: () => void;
}

/**
 * Poll the aggregated feedback summary for the continuous-loop dashboard.
 *
 * Polls on a steady cadence while mounted — signals arrive continuously as the
 * operator reviews catalogs, and a 15s beat keeps the view live without being
 * chatty. Set `enabled` false to pause it when the panel is collapsed.
 */
export function useFeedbackSummary(enabled = true, days = 30): UseFeedbackSummaryResult {
    const auth = useAuth();
    const idToken = auth.user?.id_token;
    const [summary, setSummary] = useState<FeedbackSummary | null>(null);
    // Starts true so the panel stays hidden until the first read resolves;
    // cleared from the fetch callback, never synchronously in the effect body
    // (react-hooks/set-state-in-effect).
    const [loading, setLoading] = useState(true);
    const [tick, setTick] = useState(0);

    const refresh = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
        if (!enabled || !idToken) return;
        let cancelled = false;

        // State is set from the fetch callback (an external system), never
        // synchronously in the effect body.
        void fetchFeedbackSummary(idToken, days).then((next) => {
            if (cancelled) return;
            setSummary(next);
            setLoading(false);
        });

        return () => {
            cancelled = true;
        };
    }, [enabled, idToken, days, tick]);

    useEffect(() => {
        if (!enabled || !idToken) return;
        const id = window.setInterval(() => setTick((t) => t + 1), POLL_MS);
        return () => window.clearInterval(id);
    }, [enabled, idToken]);

    return { summary, loading, refresh };
}
