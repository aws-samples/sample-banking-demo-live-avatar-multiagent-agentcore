import { useState } from "react";
import { Scale, ShieldCheck, AlertTriangle, ListChecks, RefreshCw } from "lucide-react";
import { useConciergeFlowStore } from "@/stores/conciergeFlowStore";
import {
    type EvaluationData,
    type EvaluationDimension,
    EVALUATION_PASS_THRESHOLD,
    evaluationScoreColor,
} from "./types";

/**
 * Bedrock LLM-as-a-judge scorecard.
 *
 * The pipeline's evaluator phase runs a distinct Bedrock judge model over the
 * delivered report and scores it — against the brief and the evidence actually
 * gathered — on Bedrock Evaluations' metric taxonomy (Correctness, Faithfulness,
 * Citation precision, Completeness, Coherence). This component renders that
 * result two ways:
 *   - `EvaluationScorecardCard` — the full card, shown inline in the chat.
 *   - `EvaluationSummary`       — a compact readout for the flow panel's Run
 *                                 Report, driven by the shared flow store.
 */

const JUDGE_LABEL: Record<string, string> = {
    "us.amazon.nova-pro-v1:0": "Nova Pro",
    "amazon.nova-pro-v1:0": "Nova Pro",
    "amazon.nova-2-lite-v1:0": "Nova 2 Lite",
    "us.anthropic.claude-sonnet-4-6": "Claude Sonnet 4.6",
};

export function judgeLabel(modelId: string): string {
    if (!modelId) return "Bedrock judge";
    return JUDGE_LABEL[modelId] ?? modelId.split(/[/.:]/).slice(-2, -1)[0] ?? modelId;
}

function coerce(props: Partial<EvaluationData>): EvaluationData | null {
    const dimensions = Array.isArray(props.dimensions) ? props.dimensions : [];
    if (typeof props.overall !== "number" && dimensions.length === 0) return null;
    const overall =
        typeof props.overall === "number"
            ? props.overall
            : Math.round(
                  dimensions.reduce((s, d) => s + (d.score ?? 0), 0) / (dimensions.length || 1)
              );
    return {
        target: props.target === "catalog" ? "catalog" : "report",
        judgeModel: props.judgeModel ?? "",
        overall,
        verdict:
            props.verdict === "revise"
                ? "revise"
                : overall >= EVALUATION_PASS_THRESHOLD
                  ? "pass"
                  : "revise",
        summary: props.summary ?? "",
        criteria: Array.isArray(props.criteria) ? props.criteria : [],
        dimensions,
        gaps: Array.isArray(props.gaps) ? props.gaps : [],
        reportText: typeof props.reportText === "string" ? props.reportText : undefined,
        query: typeof props.query === "string" ? props.query : undefined,
    };
}

// ── Full card (chat) ────────────────────────────────────────────────────────

export function EvaluationScorecardCard(
    props: Partial<EvaluationData> & {
        /** Injected by the message renderer; fires the revise action. */
        onAction?: (action: string, data: unknown) => void;
    }
): JSX.Element | null {
    const { onAction } = props;
    const [revising, setRevising] = useState(false);
    const data = coerce(props);
    if (!data) return null;

    const pass = data.verdict === "pass";
    const overallColor = evaluationScoreColor(data.overall);

    // Sub-threshold dimensions are the "yellow/red" bars the revise pass targets.
    const weakDimensions = data.dimensions.filter((d) => d.score < EVALUATION_PASS_THRESHOLD);
    // Revising needs the prior report to fix in place; without it (or with
    // nothing weak) the button would have nothing to act on.
    const canRevise = !pass && weakDimensions.length > 0 && !!data.reportText;

    const handleRevise = (): void => {
        setRevising(true);
        onAction?.("research_revise", {
            report_text: data.reportText,
            weak_dimensions: weakDimensions.map((d) => ({
                label: d.label,
                score: d.score,
                metricRef: d.metricRef,
                rationale: d.rationale,
            })),
            gaps: data.gaps,
            query: data.query,
        });
    };

    return (
        <section
            className="rounded-lg p-4"
            style={{ border: "1px solid var(--glass-border)", background: "var(--glass-bg)" }}
            aria-label="Bedrock evaluation scorecard"
        >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span
                    className="flex items-center gap-2 text-sm font-semibold"
                    style={{ color: "var(--app-text)" }}
                >
                    <Scale size={16} /> Bedrock Evaluations
                    <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{
                            border: "1px solid var(--glass-border)",
                            color: "var(--app-text-secondary)",
                        }}
                    >
                        LLM-as-a-judge
                    </span>
                </span>
                <span
                    className="text-[11px]"
                    style={{ color: "var(--app-text-secondary)" }}
                    title="The Bedrock model that scored this run"
                >
                    Judge: {judgeLabel(data.judgeModel)}
                </span>
            </div>

            {/* Overall + verdict gate */}
            <div className="mb-4 flex items-center gap-4">
                <div className="flex flex-col items-center">
                    <span
                        className="text-3xl font-bold leading-none"
                        style={{ color: overallColor }}
                    >
                        {data.overall}
                    </span>
                    <span
                        className="mt-0.5 text-[10px] uppercase tracking-wide"
                        style={{ color: "var(--app-text-secondary)" }}
                    >
                        / 100
                    </span>
                </div>
                <div className="min-w-0 flex-1">
                    <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                        style={{
                            color: pass ? "#37b24d" : "#e0b850",
                            background: pass ? "#37b24d1a" : "#e0b8501a",
                            border: `1px solid ${pass ? "#37b24d55" : "#e0b85055"}`,
                        }}
                    >
                        {pass ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}
                        {pass ? "Passes quality gate" : "Flagged for revision"}
                    </span>
                    {data.summary ? (
                        <p
                            className="mt-1.5 text-xs leading-snug"
                            style={{ color: "var(--app-text)" }}
                        >
                            {data.summary}
                        </p>
                    ) : null}
                    {canRevise ? (
                        <button
                            onClick={handleRevise}
                            disabled={revising}
                            className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                            style={{
                                color: "#e0b850",
                                background: "#e0b8501a",
                                border: "1px solid #e0b85055",
                            }}
                            title="Re-run synthesis to fix the sub-threshold dimensions, then re-evaluate"
                        >
                            <RefreshCw size={12} className={revising ? "animate-spin" : ""} />
                            {revising
                                ? "Revising…"
                                : `Revise ${weakDimensions.length} weak area${
                                      weakDimensions.length === 1 ? "" : "s"
                                  }: ${weakDimensions.map((d) => d.label).join(", ")}`}
                        </button>
                    ) : null}
                </div>
            </div>

            {/* Dimension bars */}
            <div className="flex flex-col gap-2.5">
                {data.dimensions.map((d) => (
                    <DimensionRow key={d.key} dim={d} />
                ))}
            </div>

            {/* Criteria the report was judged against */}
            {data.criteria.length > 0 && (
                <div className="mt-4">
                    <div
                        className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: "var(--app-text-secondary)" }}
                    >
                        <ListChecks size={13} /> Judged against
                    </div>
                    <ul className="ml-1 list-disc space-y-0.5 pl-4">
                        {data.criteria.map((c, i) => (
                            <li
                                key={i}
                                className="text-[11.5px]"
                                style={{ color: "var(--app-text)" }}
                            >
                                {c}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Top gaps the judge flagged */}
            {data.gaps.length > 0 && (
                <div className="mt-3">
                    <div
                        className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: "var(--app-text-secondary)" }}
                    >
                        <AlertTriangle size={13} /> Top gaps &amp; fixes
                    </div>
                    <ul className="ml-1 list-disc space-y-0.5 pl-4">
                        {data.gaps.map((g, i) => (
                            <li
                                key={i}
                                className="text-[11.5px]"
                                style={{ color: "var(--app-text)" }}
                            >
                                {g}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <p
                className="mt-3 text-[10px] leading-snug"
                style={{ color: "var(--app-text-secondary)" }}
            >
                Scored by a Bedrock judge model against the brief and gathered evidence, using
                Bedrock Evaluations' metric taxonomy. Metric names shown per dimension.
            </p>
        </section>
    );
}

function DimensionRow({ dim }: { dim: EvaluationDimension }): JSX.Element {
    const color = evaluationScoreColor(dim.score);
    return (
        <div>
            <div className="mb-0.5 flex items-baseline justify-between gap-2">
                <span className="flex items-baseline gap-1.5 truncate">
                    <span
                        className="text-[12.5px] font-medium"
                        style={{ color: "var(--app-text)" }}
                    >
                        {dim.label}
                    </span>
                    {dim.metricRef ? (
                        <span
                            className="text-[10px]"
                            style={{ color: "var(--app-text-secondary)" }}
                        >
                            · {dim.metricRef}
                        </span>
                    ) : null}
                </span>
                <span className="shrink-0 text-[12px] font-semibold" style={{ color }}>
                    {dim.score}
                </span>
            </div>
            <div
                className="h-1.5 overflow-hidden rounded-full"
                style={{ background: "var(--glass-border)" }}
            >
                <div
                    style={{
                        width: `${Math.max(0, Math.min(100, dim.score))}%`,
                        height: "100%",
                        background: color,
                    }}
                />
            </div>
            {dim.rationale ? (
                <p
                    className="mt-0.5 text-[10.5px] leading-snug"
                    style={{ color: "var(--app-text-secondary)" }}
                >
                    {dim.rationale}
                </p>
            ) : null}
        </div>
    );
}

// ── Compact summary (flow panel Run Report) ──────────────────────────────────

/**
 * Dark-themed condensed scorecard for the flow panel. Reads the shared flow
 * store so it lights up the moment the evaluator phase reports, on every
 * experience that runs a pipeline.
 */
export function EvaluationSummary(): JSX.Element | null {
    const evaluation = useConciergeFlowStore((s) => s.evaluation);
    const evaluating = useConciergeFlowStore((s) => s.evaluating);

    // Live pending state: the judge is running but has not reported yet. Makes
    // evaluation a visible, in-progress moment instead of a card that only
    // appears once it finishes.
    if (!evaluation && evaluating) {
        return (
            <section
                className="border-t border-slate-800 px-4 py-3"
                aria-label="Bedrock evaluation in progress"
            >
                <div className="flex items-center gap-2">
                    <Scale size={13} className="animate-pulse text-amber-300" />
                    <span className="text-xs font-semibold text-slate-100">Bedrock Evaluation</span>
                    <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium text-amber-300">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
                        Evaluating…
                    </span>
                </div>
                <p className="mt-1.5 text-[10.5px] leading-snug text-slate-500">
                    An LLM-as-a-judge model is scoring the report against the brief and the evidence
                    gathered.
                </p>
                {/* Skeleton dimension bars so the panel has visible, animated
                    substance while the judge runs. */}
                <div className="mt-2 flex flex-col gap-1.5">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                            <div className="h-full w-1/3 animate-pulse rounded-full bg-slate-600" />
                        </div>
                    ))}
                </div>
            </section>
        );
    }

    if (!evaluation) return null;

    const pass = evaluation.verdict === "pass";
    const overallColor = evaluationScoreColor(evaluation.overall);

    return (
        <section className="border-t border-slate-800 px-4 py-3" aria-label="Bedrock evaluation">
            <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
                    <Scale size={13} /> Bedrock Evaluation
                </span>
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                    judge · {judgeLabel(evaluation.judgeModel)}
                </span>
            </div>
            <div className="mb-2 flex items-center gap-3">
                <span className="text-2xl font-bold leading-none" style={{ color: overallColor }}>
                    {evaluation.overall}
                </span>
                <span className="text-[10px] text-slate-500">/ 100</span>
                <span
                    className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{
                        color: pass ? "#4fd1a5" : "#e0b850",
                        background: pass ? "#4fd1a51a" : "#e0b8501a",
                        border: `1px solid ${pass ? "#4fd1a555" : "#e0b85055"}`,
                    }}
                >
                    {pass ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />}
                    {pass ? "Pass" : "Revise"}
                </span>
            </div>
            <div className="flex flex-col gap-1">
                {evaluation.dimensions.map((d) => (
                    <div key={d.key} className="flex items-center gap-2">
                        <span
                            className="w-28 shrink-0 truncate text-[10px] text-slate-400"
                            title={d.metricRef}
                        >
                            {d.label}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                            <div
                                style={{
                                    width: `${Math.max(0, Math.min(100, d.score))}%`,
                                    height: "100%",
                                    background: evaluationScoreColor(d.score),
                                }}
                            />
                        </div>
                        <span className="w-6 shrink-0 text-right text-[10px] font-medium text-slate-300">
                            {d.score}
                        </span>
                    </div>
                ))}
            </div>
        </section>
    );
}
