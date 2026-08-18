import { create } from "zustand";
import { normalizeToolName } from "@/components/concierge-flow/flow-types";
import type { EvaluationData } from "@/components/common/evaluation/types";
import type { GroundedSource } from "@/components/common/flow/grounding";

export type NodeActivity = "idle" | "active" | "completed";

export interface ToolEvent {
    toolUseId: string;
    name: string;
    status: "running" | "complete";
    startedAt: number;
    completedAt?: number;
}

export type { GroundedSource };

interface ConciergeFlowState {
    /** Active mode for which tools are being tracked. Cleared on reset. */
    runtimeActive: boolean;
    /** Tools that have ever been called in this session (by name). */
    invokedTools: Set<string>;
    /** Call count per tool name. */
    callCounts: Record<string, number>;
    /** Chronological event log. */
    events: ToolEvent[];
    /** Currently running tool name (null when idle). */
    activeTool: string | null;
    /** Wall-clock start of the current/last run (ms epoch), null before first run. */
    runStartedAt: number | null;
    /** Wall-clock end of the last completed run (ms epoch), null while running. */
    runEndedAt: number | null;
    /**
     * Real spend committed via AgentCore Payments, or null when the run bought
     * nothing / payments are disabled. Distinct from the report's estimated
     * inference cost.
     */
    paymentSpend: { spent: string; budget: string; currency: string; sessions: number } | null;
    /**
     * Bedrock LLM-as-a-judge result for the current/last run, or null before the
     * evaluator phase reports. Drives the Run Report's evaluation tile so every
     * experience shows the same score without an extra fetch.
     */
    evaluation: EvaluationData | null;
    /**
     * True while the evaluator phase is running but before its scorecard has
     * arrived. Drives the Run Report's "Evaluating…" pending state and the
     * judge model chip's live pulse, so evaluation is visibly happening rather
     * than only appearing once finished. Only pipeline modes (research/menu)
     * run an evaluator; the AI Agent never sets this.
     */
    evaluating: boolean;
    /** Concrete sources the run grounded in, aggregated across grounding tools. */
    sources: GroundedSource[];

    // actions
    runtimeStart(): void;
    runtimeEnd(): void;
    toolStart(toolUseId: string, name: string): void;
    toolEnd(toolUseId: string): void;
    setPaymentSpend(spend: {
        spent: string;
        budget: string;
        currency: string;
        sessions: number;
    }): void;
    setEvaluation(evaluation: EvaluationData): void;
    setEvaluating(evaluating: boolean): void;
    addSources(sources: GroundedSource[]): void;
    reset(): void;
}

export const useConciergeFlowStore = create<ConciergeFlowState>((set) => ({
    runtimeActive: false,
    invokedTools: new Set<string>(),
    callCounts: {},
    events: [],
    activeTool: null,
    runStartedAt: null,
    runEndedAt: null,
    paymentSpend: null,
    evaluation: null,
    evaluating: false,
    sources: [],

    setPaymentSpend: (spend) => set({ paymentSpend: spend }),
    // A finished score supersedes the pending state.
    setEvaluation: (evaluation) => set({ evaluation, evaluating: false }),
    setEvaluating: (evaluating) => set({ evaluating }),
    addSources: (incoming) =>
        set((s) => {
            const seen = new Set(s.sources.map((x) => `${x.kind}|${x.title}|${x.url ?? ""}`));
            const merged = [...s.sources];
            for (const src of incoming) {
                const key = `${src.kind}|${src.title}|${src.url ?? ""}`;
                if (seen.has(key)) continue;
                seen.add(key);
                merged.push(src);
            }
            return { sources: merged };
        }),

    runtimeStart: () =>
        set({
            runtimeActive: true,
            runStartedAt: Date.now(),
            runEndedAt: null,
            // Clear last run's spend, score, and sources so a new run never shows stale data.
            paymentSpend: null,
            evaluation: null,
            evaluating: false,
            sources: [],
        }),
    // Clear the pending eval flag too: if the run ended without a scorecard
    // (judge failed or was skipped), the "Evaluating…" state must not stick.
    runtimeEnd: () =>
        set({ runtimeActive: false, activeTool: null, runEndedAt: Date.now(), evaluating: false }),

    toolStart: (toolUseId, name) =>
        set((s) => {
            const clean = normalizeToolName(name);
            const invoked = new Set(s.invokedTools);
            invoked.add(clean);
            return {
                invokedTools: invoked,
                callCounts: { ...s.callCounts, [clean]: (s.callCounts[clean] ?? 0) + 1 },
                events: [
                    ...s.events,
                    { toolUseId, name: clean, status: "running", startedAt: Date.now() },
                ],
                activeTool: clean,
            };
        }),

    toolEnd: (toolUseId) =>
        set((s) => {
            const events = s.events.map((e) =>
                e.toolUseId === toolUseId
                    ? { ...e, status: "complete" as const, completedAt: Date.now() }
                    : e
            );
            // Active tool cleared only if this was the active one
            const stillRunning = events.find((e) => e.status === "running");
            return { events, activeTool: stillRunning?.name ?? null };
        }),

    reset: () =>
        set({
            runtimeActive: false,
            invokedTools: new Set<string>(),
            callCounts: {},
            events: [],
            activeTool: null,
            runStartedAt: null,
            runEndedAt: null,
            paymentSpend: null,
            evaluation: null,
            evaluating: false,
            sources: [],
        }),
}));
