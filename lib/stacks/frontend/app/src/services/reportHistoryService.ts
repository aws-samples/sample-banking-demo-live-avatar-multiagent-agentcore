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

/**
 * A freshly signed URL for one report, or null when it no longer exists.
 *
 * Called at the moment a report is opened rather than when it was generated, so
 * a link in an old chat message still works. Returns null on 404 — the report
 * has aged out of the bucket — and throws on anything else, so a genuine outage
 * is not reported to the user as a missing file.
 */
export async function fetchReportUrl(idToken: string, reportId: string): Promise<string | null> {
    const base = getApiUrl();
    if (!base) throw new Error("Report history endpoint is not configured");

    const response = await fetch(`${base}/${encodeURIComponent(reportId)}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
        },
    });

    if (response.status === 404) return null;
    if (!response.ok) {
        throw new Error(`Could not open the report (HTTP ${response.status})`);
    }

    const body = (await response.json()) as { report?: ReportHistoryItem };
    return body.report?.url ?? null;
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
