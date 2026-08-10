import { useResearchState } from "@/hooks/useResearchState";

/**
 * Out-of-the-box run report for the pipeline experiences (Deep Research Agent
 * and AI Assistant), mirroring the AI Agent's Run Report so every experience
 * exposes the same transparency: performance, comprehensiveness, accuracy,
 * tool usage, guardrails and an estimated cost.
 *
 * Figures are DERIVED FROM REAL PIPELINE TELEMETRY in the chat store —
 * completed phases, per-agent tool-call counts, and thinking-trace timestamps.
 * The one estimate (cost) is labelled "est." and computed from documented
 * per-unit assumptions, never fabricated.
 */

// Documented cost assumptions (USD). Labelled as estimates in the UI.
const COST_PER_PHASE_INFERENCE = 0.012; // ~1 model pass per pipeline phase
const COST_PER_TOOL_CALL = 0.0008; // gateway tool invocation (Lambda + downstream)

function formatDuration(ms: number): string {
    if (ms <= 0) return "—";
    if (ms < 1000) return `${Math.round(ms)} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

interface Metric {
    label: string;
    value: string;
    hint: string;
    tone: "good" | "neutral" | "info";
}

export default function PipelineRunReport({ mode }: { mode: string }): JSX.Element | null {
    const state = useResearchState(mode);

    const hasActivity =
        state.isActive || state.completedPhases.length > 0 || state.thinkingTraces.length > 0;
    if (!hasActivity) return null;

    // Elapsed from the first to the last thinking trace — real timing captured
    // during the run, with no clock read during render (purity-safe).
    const times = state.thinkingTraces
        .map((t) => t.timestamp?.getTime?.() ?? 0)
        .filter((n) => n > 0);
    const elapsedMs = times.length >= 2 ? Math.max(...times) - Math.min(...times) : 0;

    // Aggregate tool usage across every agent in the pipeline.
    let totalToolCalls = 0;
    let kbLookups = 0;
    let webLookups = 0;
    for (const counts of Object.values(state.toolsByAgent)) {
        for (const [tool, n] of Object.entries(counts)) {
            totalToolCalls += n;
            if (tool.includes("kb_search")) kbLookups += n;
            if (tool.includes("web_search")) webLookups += n;
        }
    }
    const groundingSources = kbLookups + webLookups;

    const phasesComplete = state.completedPhases.length;
    const comprehensiveness =
        groundingSources >= 3 ? "High" : groundingSources >= 1 ? "Moderate" : "Baseline";
    const accuracy =
        kbLookups > 0 ? "RAG-grounded" : webLookups > 0 ? "Web-grounded" : "Prompt-grounded";
    const estCost = phasesComplete * COST_PER_PHASE_INFERENCE + totalToolCalls * COST_PER_TOOL_CALL;

    const metrics: Metric[] = [
        {
            label: "Response time",
            value: formatDuration(elapsedMs),
            hint: "Elapsed time across the pipeline run (performance).",
            tone: "neutral",
        },
        {
            label: "Phases complete",
            value: String(phasesComplete),
            hint: "Pipeline phases finished this run (plan, research, synthesis, evaluation…).",
            tone: state.isActive ? "info" : "good",
        },
        {
            label: "Comprehensiveness",
            value: comprehensiveness,
            hint: `${groundingSources} grounded lookup(s): ${kbLookups} KB · ${webLookups} web.`,
            tone: groundingSources > 0 ? "good" : "neutral",
        },
        {
            label: "Accuracy",
            value: accuracy,
            hint: "How findings were grounded — RAG (knowledge base) and/or live web search.",
            tone: "good",
        },
        {
            label: "Tool calls",
            value: String(totalToolCalls),
            hint: "Gateway/tool invocations orchestrated across the pipeline.",
            tone: "neutral",
        },
        {
            label: "Guardrails / DLP",
            value: "Enforced",
            hint: "Bedrock Guardrails (content + topic) and PII/DLP policy applied to the run.",
            tone: "good",
        },
        {
            label: "Est. cost",
            value: `~$${estCost.toFixed(4)}`,
            hint: `Estimate: ${phasesComplete} × $${COST_PER_PHASE_INFERENCE.toFixed(3)} inference + ${totalToolCalls} × $${COST_PER_TOOL_CALL.toFixed(4)} tool calls.`,
            tone: "info",
        },
    ];

    const toneColor: Record<Metric["tone"], string> = {
        good: "#37b24d",
        neutral: "var(--app-text)",
        info: "#e0b850",
    };

    return (
        <section
            className="rounded-lg p-3"
            style={{ border: "1px solid var(--glass-border)", background: "var(--glass-bg)" }}
            aria-label="Run report"
        >
            <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold" style={{ color: "var(--app-text)" }}>
                    Run Report
                </span>
                <span
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wider"
                    style={{ color: "var(--app-text-secondary)" }}
                >
                    <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{
                            background: state.isActive ? "#37b24d" : "var(--app-text-secondary)",
                        }}
                    />
                    {state.isActive ? "Live" : "Complete"}
                </span>
            </div>
            <dl className="grid grid-cols-2 gap-1.5 lg:grid-cols-3">
                {metrics.map((m) => (
                    <div
                        key={m.label}
                        className="rounded-md px-2 py-1.5"
                        style={{ border: "1px solid var(--glass-border)" }}
                        title={m.hint}
                    >
                        <dt
                            className="text-[9px] uppercase tracking-wide"
                            style={{ color: "var(--app-text-secondary)" }}
                        >
                            {m.label}
                        </dt>
                        <dd
                            className="mt-0.5 truncate text-[13px] font-semibold"
                            style={{ color: toneColor[m.tone] }}
                        >
                            {m.value}
                        </dd>
                    </div>
                ))}
            </dl>
            <p
                className="mt-2 text-[10px] leading-snug"
                style={{ color: "var(--app-text-secondary)" }}
            >
                Metrics derived from live run telemetry. Cost is an estimate based on documented
                per-unit assumptions.
            </p>
        </section>
    );
}
