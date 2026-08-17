import { create } from "zustand";
import { normalizeToolName } from "@/components/concierge-flow/flow-types";
import type { EvaluationData } from "@/components/common/evaluation/types";

export type NodeActivity = "idle" | "active" | "completed";

export interface ToolEvent {
    toolUseId: string;
    name: string;
    status: "running" | "complete";
    startedAt: number;
    completedAt?: number;
}

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

    setPaymentSpend: (spend) => set({ paymentSpend: spend }),
    setEvaluation: (evaluation) => set({ evaluation }),

    runtimeStart: () =>
        set({
            runtimeActive: true,
            runStartedAt: Date.now(),
            runEndedAt: null,
            // Clear last run's spend and score so a new run never shows stale data.
            paymentSpend: null,
            evaluation: null,
        }),
    runtimeEnd: () => set({ runtimeActive: false, activeTool: null, runEndedAt: Date.now() }),

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
        }),
}));
