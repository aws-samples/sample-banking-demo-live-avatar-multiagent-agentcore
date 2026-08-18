import { create } from "zustand";
import { normalizeToolName } from "@/components/concierge-flow/flow-types";
import type { EvaluationData } from "@/components/common/evaluation/types";
import type { GroundedSource } from "@/components/common/flow/grounding";

export type NodeActivity = "idle" | "active" | "completed";

/**
 * Lifecycle of the agent-to-agent (A2A) collaboration step shown in the flow
 * panel. Extends {@link NodeActivity} with a terminal `failed` state because the
 * A2A hop is the one flow node that can visibly fail (Requirement 9.4).
 */
export type A2AStatus = "idle" | "active" | "completed" | "failed";

/**
 * Lifecycle of the Bedrock Prompt Optimization showcase step shown in the flow
 * panel. Mirrors {@link A2AStatus}: idle → active while `OptimizePrompt`
 * requests stream, then a terminal `completed` (a Selected_Variant is applied)
 * or `failed` (every target model failed) — the one other flow node besides A2A
 * that can visibly fail (Requirement 9.4).
 */
export type PromptOptStatus = "idle" | "active" | "completed" | "failed";

/**
 * The lifecycle inputs that drive the prompt-optimization flow node:
 * - `step_start` — optimization began (idle → `active`),
 * - `variant_applied` — the presenter applied a Selected_Variant (→ `completed`),
 * - `all_targets_failed` — every target model failed (→ `failed`).
 *
 * The node MAY remain `active` until one of the terminal inputs arrives
 * (Requirement 9.1–9.4).
 */
export type PromptOptLifecycleEvent = "step_start" | "variant_applied" | "all_targets_failed";

/**
 * Pure fold of a prompt-optimization lifecycle sequence to the flow-node status.
 * Exported so Property 9 can exercise the fold without a live store: `step_start`
 * moves idle → `active`, `variant_applied` is the terminal success, and
 * `all_targets_failed` is the terminal failure. The node stays `active` until a
 * terminal input arrives (Requirement 9.1, 9.2, 9.3, 9.4).
 */
export function foldPromptOptStatus(events: readonly PromptOptLifecycleEvent[]): PromptOptStatus {
    let status: PromptOptStatus = "idle";
    for (const event of events) {
        switch (event) {
            case "step_start":
                if (status === "idle") status = "active";
                break;
            case "variant_applied":
                status = "completed";
                break;
            case "all_targets_failed":
                status = "failed";
                break;
        }
    }
    return status;
}

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
    /**
     * State of the cross-team agent-to-agent (A2A) collaboration step — the
     * account-opening agent consulting the fraud-research agent over A2A during
     * KYC. `status` drives the flow-panel node (idle → active → completed, or
     * failed on error); `identityForwarded` reflects that the customer's
     * verified identity is carried across the hop (Requirement 9.2). The node
     * MAY remain `active` until the terminal event arrives.
     */
    a2a: { status: A2AStatus; identityForwarded: boolean };
    /**
     * State of the Bedrock Prompt Optimization showcase step. `status` drives
     * the flow-panel node: `active` while `OptimizePrompt` requests stream,
     * `completed` when the presenter applies a Selected_Variant, and `failed`
     * when every target model fails. The node MAY remain `active` until a
     * terminal event arrives (Requirement 9.1–9.4).
     */
    promptOpt: { status: PromptOptStatus };

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
    /** Begin the A2A step: mark it active and record whether identity is forwarded. */
    a2aStart(identityForwarded: boolean): void;
    /** Complete the A2A step. */
    a2aEnd(): void;
    /** Fail the A2A step. */
    a2aError(): void;
    /** Begin the prompt-optimization step: mark it active. */
    promptOptStart(): void;
    /** Complete the prompt-optimization step (a Selected_Variant was applied). */
    promptOptComplete(): void;
    /** Fail the prompt-optimization step (every target model failed). */
    promptOptFail(): void;
    reset(): void;
}

const initialA2A: { status: A2AStatus; identityForwarded: boolean } = {
    status: "idle",
    identityForwarded: false,
};

const initialPromptOpt: { status: PromptOptStatus } = { status: "idle" };

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
    a2a: initialA2A,
    promptOpt: initialPromptOpt,

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

    a2aStart: (identityForwarded) => set({ a2a: { status: "active", identityForwarded } }),
    // Keep identityForwarded so the completed/failed node still shows the
    // identity-carried indicator (Requirement 9.2).
    a2aEnd: () => set((s) => ({ a2a: { ...s.a2a, status: "completed" } })),
    a2aError: () => set((s) => ({ a2a: { ...s.a2a, status: "failed" } })),

    // The prompt-optimization node mirrors the A2A lifecycle: start → active,
    // apply a Selected_Variant → completed, all targets failed → failed.
    promptOptStart: () => set({ promptOpt: { status: "active" } }),
    promptOptComplete: () => set({ promptOpt: { status: "completed" } }),
    promptOptFail: () => set({ promptOpt: { status: "failed" } }),

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
            a2a: initialA2A,
            promptOpt: initialPromptOpt,
        }),
}));
