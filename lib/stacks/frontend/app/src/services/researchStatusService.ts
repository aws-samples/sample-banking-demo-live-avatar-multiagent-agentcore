/**
 * Grounding readiness for the AI Assistant.
 *
 * Knowledge Base ingestion is asynchronous, so the newest deep-research report
 * is not immediately retrievable. Polling this lets the UI say "indexing…"
 * rather than letting the assistant quietly design an ungrounded catalog.
 */

export type IngestionState = "ready" | "indexing" | "pending" | "unknown" | "none";

export interface LatestReport {
    reportId: string;
    title: string;
    createdAt: string;
}

export interface ResearchStatus {
    latestReport: LatestReport | null;
    ingestion: { state: IngestionState; detail: string };
    /** True when the assistant can ground itself in the latest report. */
    ready: boolean;
    pipeline: string;
}

function getApiUrl(): string {
    const base = import.meta.env.VITE_FEEDBACK_API_URL;
    return base ? `${base}research-status` : "";
}

export async function fetchResearchStatus(idToken: string): Promise<ResearchStatus | null> {
    const url = getApiUrl();
    if (!url) return null;
    try {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!response.ok) return null;
        return (await response.json()) as ResearchStatus;
    } catch {
        // A status read failing must never block the page — the caller treats
        // null as "cannot tell" and lets the user proceed.
        return null;
    }
}
