import { useCallback, useEffect, useState } from "react";
import { useAuth } from "react-oidc-context";
import { fetchResearchStatus, type ResearchStatus } from "@/services/researchStatusService";

/** Poll interval while ingestion is in flight. */
const POLL_MS = 5000;

export interface UseResearchStatusResult {
    status: ResearchStatus | null;
    /** True while the strategy report is still being indexed. */
    indexing: boolean;
    refresh: () => void;
}

/**
 * Track whether the latest deep-research report is queryable.
 *
 * Polls only while ingestion is actually in flight, then stops — a page left
 * open on a ready report should not keep hitting the endpoint forever.
 */
export function useResearchStatus(enabled = true): UseResearchStatusResult {
    const auth = useAuth();
    const idToken = auth.user?.id_token;
    const [status, setStatus] = useState<ResearchStatus | null>(null);
    const [tick, setTick] = useState(0);

    const refresh = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
        if (!enabled || !idToken) return;
        let cancelled = false;

        // State is set from the fetch callback (an external system), never
        // synchronously in the effect body.
        void fetchResearchStatus(idToken).then((next) => {
            if (!cancelled) setStatus(next);
        });

        return () => {
            cancelled = true;
        };
    }, [enabled, idToken, tick]);

    const indexing = status?.ingestion.state === "indexing" || status?.ingestion.state === "pending";

    // Keep polling only while there is something to wait for.
    useEffect(() => {
        if (!enabled || !indexing) return;
        const id = window.setInterval(() => setTick((t) => t + 1), POLL_MS);
        return () => window.clearInterval(id);
    }, [enabled, indexing]);

    return { status, indexing, refresh };
}
