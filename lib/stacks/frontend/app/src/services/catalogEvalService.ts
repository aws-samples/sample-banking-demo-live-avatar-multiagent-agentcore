/**
 * Catalog evaluation status service.
 *
 * Polls the backend `/catalog-eval` endpoint for the async Bedrock
 * model-evaluation jobs launched by the ServicesCatalog card, so the card can
 * show live status and render the copy-quality score once each job completes.
 */

export interface EvalJobStatus {
    jobArn: string;
    jobName?: string;
    /** Bedrock job status: InProgress | Completed | Failed | Stopped | ... */
    status: string;
    done: boolean;
    /** Mean copy_quality score (0-100) once Completed, else null. */
    score: number | null;
    failure?: string;
}

export interface EvalStatusResponse {
    jobs: EvalJobStatus[];
    allDone: boolean;
}

function getApiUrl(): string {
    const base = import.meta.env.VITE_FEEDBACK_API_URL;
    return base ? `${base}catalog-eval` : "";
}

/** Fetch current status/score for the given evaluation job ARNs. */
export async function fetchEvalStatus(
    jobArns: string[],
    idToken: string
): Promise<EvalStatusResponse> {
    const apiUrl = getApiUrl();
    if (!apiUrl || jobArns.length === 0) {
        return { jobs: [], allDone: false };
    }
    const url = `${apiUrl}?jobs=${encodeURIComponent(jobArns.join(","))}`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as EvalStatusResponse;
}
