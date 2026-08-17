/**
 * Shared shape for a Bedrock LLM-as-a-judge evaluation result.
 *
 * Produced by the pipeline's evaluator phase (a distinct Bedrock judge model
 * scoring the delivered report against the brief and gathered evidence) and
 * surfaced identically in the chat (full card) and the flow panel (compact
 * summary in the Run Report).
 */

export interface EvaluationDimension {
    /** Stable key used for React lists. */
    key: string;
    /** Human label as scored (e.g. "Groundedness"). */
    label: string;
    /** 0-100. */
    score: number;
    /** One-line rationale from the judge. */
    rationale: string;
    /** The Bedrock Evaluations metric this maps to (e.g. "Faithfulness"). */
    metricRef: string;
}

export interface EvaluationData {
    /** What was scored. */
    target: "report" | "catalog";
    /** Bedrock model id that acted as the judge. */
    judgeModel: string;
    /** Rounded overall score, 0-100. */
    overall: number;
    /** Quality gate outcome derived from `overall`. */
    verdict: "pass" | "revise";
    /** The judge's one-line overall verdict text. */
    summary: string;
    /** Criteria the report was judged against (from the research plan). */
    criteria: string[];
    dimensions: EvaluationDimension[];
    /** Top actionable gaps the judge flagged. */
    gaps: string[];
}

/** Score at or above this is a pass; below it the run is flagged for revision. */
export const EVALUATION_PASS_THRESHOLD = 80;

/** Color for a 0-100 score, aligned with the Run Report's tone palette. */
export function evaluationScoreColor(score: number): string {
    if (score >= EVALUATION_PASS_THRESHOLD) return "#37b24d";
    if (score >= 60) return "#e0b850";
    return "#f03e3e";
}
