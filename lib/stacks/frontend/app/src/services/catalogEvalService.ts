/**
 * Catalog evaluation status service.
 *
 * Polls the backend `/catalog-eval` endpoint for the async Bedrock
 * model-evaluation jobs launched by the ServicesCatalog card, so the card can
 * show live status and render the copy-quality score once each job completes.
 */

/** One judged catalog item: the copy, its score, and the judge's reasoning. */
export interface EvalItemResult {
    product?: string;
    response?: string;
    score?: number | null;
    reasoning?: string;
}

export interface EvalJobStatus {
    jobArn: string;
    jobName?: string;
    /** Bedrock job status: InProgress | Completed | Failed | Stopped | ... */
    status: string;
    done: boolean;
    /** Mean copy_quality score (0-100) once Completed, else null. */
    score: number | null;
    /** Percentage of items the judge rated excellent (0-100). */
    passRate?: number | null;
    /** Number of items scored. */
    count?: number;
    /** Rubric dimensions the judge scored against. */
    dimensions?: string[];
    /** Per-item score + judge reasoning (capped). */
    items?: EvalItemResult[];
    /** A few verbatim raw output records, for the "raw JSON" view. */
    raw?: unknown[];
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

export interface BatchEvalStatus {
    batchEvaluationId: string;
    /** AgentCore batch status: PENDING | IN_PROGRESS | COMPLETED | ... */
    status: string;
    done: boolean;
    /** Mean copy-quality score (0-100) once complete, else null. */
    score: number | null;
    /** Number of per-session scores read from the results log stream. */
    count?: number;
    /** A sample evaluator explanation, when available. */
    explanation?: string;
    /** Session counts reported by AgentCore for the run. */
    sessionsTotal?: number;
    sessionsScored?: number;
    sessionsFailed?: number;
    /**
     * Human-readable explanation of a zero/partial result, e.g. spans had not
     * reached CloudWatch yet, or transport-only sessions were skipped. Preferred
     * over the generic "still being written" copy when present.
     */
    note?: string;
    error?: string;
}

/**
 * Whether CloudWatch Transaction Search is ingesting the agent's OpenTelemetry
 * spans. Without it there are no spans for AgentCore evaluation to score.
 */
export interface ObservabilityStatus {
    /** False only when we positively determined ingestion is not working. */
    ready: boolean;
    transactionSearchEnabled?: boolean;
    /** "CloudWatchLogs" once enabled, otherwise "XRay". */
    destination?: string;
    destinationStatus?: string;
    spansLogGroup?: string;
    consolePath?: string;
    docsUrl?: string;
    message?: string;
    /** The check itself could not run; treated as ready so it never blocks. */
    indeterminate?: boolean;
}

/** Check whether span ingestion (Transaction Search) is on, before evaluating. */
export async function fetchObservabilityStatus(idToken: string): Promise<ObservabilityStatus> {
    const apiUrl = getApiUrl();
    if (!apiUrl) return { ready: true, indeterminate: true };
    const response = await fetch(`${apiUrl}?check=observability`, {
        headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!response.ok) {
        // Never block the feature on a failed advisory check.
        return { ready: true, indeterminate: true };
    }
    return (await response.json()) as ObservabilityStatus;
}

/** Fetch current status/scores for an AgentCore batch evaluation. */
export async function fetchBatchStatus(
    batchEvaluationId: string,
    idToken: string
): Promise<BatchEvalStatus> {
    const apiUrl = getApiUrl();
    if (!apiUrl || !batchEvaluationId) {
        return { batchEvaluationId, status: "Unknown", done: false, score: null };
    }
    const url = `${apiUrl}?batch=${encodeURIComponent(batchEvaluationId)}`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as BatchEvalStatus;
}
