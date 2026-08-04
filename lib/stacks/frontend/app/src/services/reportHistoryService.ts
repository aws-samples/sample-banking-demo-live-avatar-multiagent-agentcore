/**
 * Run history — completed reports and freshly signed download links.
 *
 * Every call returns newly minted presigned URLs. Nothing here caches a URL,
 * because that is what previously broke: `pdf_generator` returns a URL valid for
 * one hour, the app held it in client state, and reopening a report from an
 * earlier run gave S3 `AccessDenied`. Fetch when the list is shown, and the link
 * is always live.
 */

export interface ReportHistoryItem {
    reportId: string;
    title: string;
    pipeline: string;
    mode: string;
    createdAt: string;
    sizeBytes: number;
    filename: string;
    /** Signed on the server per request. Null if signing failed. */
    url: string | null;
}

function getApiUrl(): string {
    const base = import.meta.env.VITE_FEEDBACK_API_URL;
    return base ? `${base}reports` : "";
}

/** True when the backend route is deployed and configured. */
export function isReportHistoryAvailable(): boolean {
    return Boolean(getApiUrl());
}

export async function fetchReportHistory(idToken: string): Promise<ReportHistoryItem[]> {
    const url = getApiUrl();
    if (!url) throw new Error("Report history endpoint is not configured");

    const response = await fetch(url, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
        },
    });

    if (!response.ok) {
        // Surface the status: 401 means the token expired, which is a different
        // fix from a 500.
        throw new Error(`Could not load run history (HTTP ${response.status})`);
    }

    const body = (await response.json()) as { reports?: ReportHistoryItem[] };
    return body.reports ?? [];
}
