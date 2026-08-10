/**
 * Continuous feedback loop summary.
 *
 * Reads the aggregated view of every thumbs rating, human edit and applied A/B
 * winner captured by the AI Assistant, so the loop can be shown turning over
 * time rather than each signal vanishing into a write-only table.
 */

export interface FeedbackTotals {
    positive: number;
    negative: number;
    total: number;
    /** positive / total, 0..1 */
    approvalRate: number;
    /** human-edit signals / total, 0..1 */
    editRate: number;
}

export interface FeedbackSourceCount {
    source: string;
    label: string;
    count: number;
}

export interface FeedbackModelWin {
    model: string;
    wins: number;
}

export interface FeedbackTrendPoint {
    date: string;
    positive: number;
    negative: number;
}

export interface FeedbackEvent {
    feedbackType: "positive" | "negative";
    source: string;
    itemName: string;
    model: string;
    createdAt: string;
}

export interface FeedbackInsight {
    tone: "positive" | "warning" | "neutral";
    text: string;
}

export interface FeedbackSummary {
    windowDays: number;
    totals: FeedbackTotals;
    bySource: FeedbackSourceCount[];
    byModel: FeedbackModelWin[];
    topModel: { model: string; wins: number } | null;
    trend: FeedbackTrendPoint[];
    recent: FeedbackEvent[];
    insights: FeedbackInsight[];
}

function getApiUrl(): string {
    const base = import.meta.env.VITE_FEEDBACK_API_URL;
    return base ? `${base}feedback/summary` : "";
}

export async function fetchFeedbackSummary(
    idToken: string,
    days = 30
): Promise<FeedbackSummary | null> {
    const base = getApiUrl();
    if (!base) return null;
    try {
        const response = await fetch(`${base}?days=${days}`, {
            headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!response.ok) return null;
        return (await response.json()) as FeedbackSummary;
    } catch {
        // A summary read failing must never break the experience — the caller
        // treats null as "no data yet" and the loop simply shows its empty state.
        return null;
    }
}
