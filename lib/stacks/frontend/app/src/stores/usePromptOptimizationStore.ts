// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { create, type StateCreator } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StreamEvent } from "@/lib/agentcore-client/types";

/**
 * Per-session client store for the Bedrock Prompt Optimization showcase. It is
 * fed by `prompt_opt` stream events (see {@link StreamEvent}) and holds the
 * per-model optimization panels, the Baseline_Variant prompt, the presenter's
 * Selected_Variant, and the before/after sample answers.
 *
 * The fold and selector logic is factored out as PURE exported helpers so the
 * property-based tests can exercise them without React or a live store. The
 * store actions are thin wrappers over those helpers.
 *
 * The Selected_Variant lives only here for the browser session — no server
 * state, no persistence — so two presenters' sessions never cross-influence
 * (Requirement 8.4, 12.6). Applying a candidate rides on each subsequent
 * `mode="chatbot"` request through the existing `model_id` /
 * `system_prompt_override` seams; it never mutates the global model selector.
 */

/** A `prompt_opt` stream event, narrowed from the parser's union. */
export type PromptOptEvent = Extract<StreamEvent, { type: "prompt_opt" }>;

/** Frontend mirror of one backend `TargetModel` (see `optimize_targets.py`). */
export interface TargetModelInfo {
    /** foundation-model ID — the only id sent to OptimizePrompt. */
    optimizeTargetId: string;
    /** invocable id (inference profile where required) used when applying. */
    invokeId: string;
    label: string;
}

/**
 * The verified target models the Current_System_Prompt may be optimized toward,
 * mirroring `SUPPORTED_TARGET_MODELS` in `patterns/orchestrator-agent/optimize_targets.py`.
 * Used to resolve a selected candidate's `invokeId` from its `targetModelId`.
 */
export const SUPPORTED_TARGET_MODELS: readonly TargetModelInfo[] = [
    {
        optimizeTargetId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
        invokeId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        label: "Claude Sonnet 4.5",
    },
    {
        optimizeTargetId: "anthropic.claude-haiku-4-5-20251001-v1:0",
        invokeId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        label: "Claude Haiku 4.5",
    },
    {
        optimizeTargetId: "anthropic.claude-3-haiku-20240307-v1:0",
        invokeId: "anthropic.claude-3-haiku-20240307-v1:0",
        label: "Claude 3 Haiku",
    },
] as const;

const BY_OPTIMIZE_ID = new Map<string, TargetModelInfo>(
    SUPPORTED_TARGET_MODELS.map((m) => [m.optimizeTargetId, m])
);

/** Look up a supported target by its foundation-model (`optimizeTargetId`). */
export function targetModelById(targetModelId: string): TargetModelInfo | undefined {
    return BY_OPTIMIZE_ID.get(targetModelId);
}

/** Per-model optimization outcome as it streams in. */
export type ModelStatus = "in_progress" | "succeeded" | "failed" | "invalid_target";

export interface ModelPanel {
    status: ModelStatus;
    label: string;
    analysis?: string;
    optimizedPrompt?: string;
}

/**
 * The variant applied to subsequent chatbot requests this session. Baseline
 * keeps the Current_Model + Current_System_Prompt; a candidate carries the
 * invocable id and its Optimized_Prompt.
 */
export type SelectedVariant =
    | { kind: "baseline" }
    | {
          kind: "candidate";
          modelId: string;
          invokeId: string;
          prompt: string;
          label: string;
          optimizedForModelId: string;
      };

/** Before/after sample answers, one per variant, with per-side failure flags. */
export interface SampleState {
    baseline?: string;
    candidate?: string;
    baselineFailed?: boolean;
    candidateFailed?: boolean;
}

/** The per-request configuration derived from the Selected_Variant. */
export interface AppliedConfig {
    /** candidate `invokeId`, or `null` for none/baseline (keep Current_Model). */
    model_id: string | null;
    /** candidate Optimized_Prompt, or `null` for none/baseline (keep Current_System_Prompt). */
    system_prompt_override: string | null;
}

const TERMINAL_STATUSES: ReadonlySet<ModelStatus> = new Set<ModelStatus>([
    "succeeded",
    "failed",
    "invalid_target",
]);

// ---------------------------------------------------------------------------
// Pure fold + selector helpers (exported for property-based testing)
// ---------------------------------------------------------------------------

/**
 * Fold a single `prompt_opt` event into the per-model panel map, returning a new
 * map. Only model-scoped events (`analysis`, `in_progress`, `optimized`,
 * `error`, `invalid_target` with a non-empty `targetModelId`) touch a panel, and
 * each event affects only its own model's panel. Step-level and sample events
 * are ignored here.
 */
export function applyModelEvent(
    models: Record<string, ModelPanel>,
    event: PromptOptEvent
): Record<string, ModelPanel> {
    const { targetModelId, modelLabel, kind, text } = event;
    if (!targetModelId) return models;

    // Guard against inherited keys ("constructor", "__proto__", "toString", …):
    // a plain object resolves those from Object.prototype, so read own keys only.
    const existing = Object.prototype.hasOwnProperty.call(models, targetModelId)
        ? models[targetModelId]
        : undefined;
    const prev: ModelPanel = existing ?? { status: "in_progress", label: modelLabel };
    const next: ModelPanel = { ...prev, label: modelLabel || prev.label };
    const isTerminal = TERMINAL_STATUSES.has(prev.status);

    switch (kind) {
        case "analysis":
            next.analysis = (prev.analysis ?? "") + text;
            if (!isTerminal) next.status = "in_progress";
            break;
        case "in_progress":
            if (!isTerminal) next.status = "in_progress";
            break;
        case "optimized":
            next.optimizedPrompt = (prev.optimizedPrompt ?? "") + text;
            next.status = "succeeded";
            break;
        case "error":
            next.status = "failed";
            break;
        case "invalid_target":
            next.status = "invalid_target";
            break;
        default:
            // step_start / step_complete / step_failed / sample / sample_error
            // are not model-panel events.
            return models;
    }

    return { ...models, [targetModelId]: next };
}

/** Fold an ordered sequence of events into the per-model panel map. */
export function foldModels(events: readonly PromptOptEvent[]): Record<string, ModelPanel> {
    return events.reduce(applyModelEvent, {} as Record<string, ModelPanel>);
}

/**
 * The set of selectable Candidate_Variants — exactly the models whose panel
 * reached `succeeded` (an optimized prompt is available to apply).
 */
export function selectableCandidateIds(models: Record<string, ModelPanel>): string[] {
    return Object.keys(models).filter((id) => models[id].status === "succeeded");
}

/** Fold a single before/after `sample` / `sample_error` event into sample state. */
export function applySampleEvent(sample: SampleState, event: PromptOptEvent): SampleState {
    if (event.variant !== "baseline" && event.variant !== "candidate") return sample;

    if (event.kind === "sample") {
        const key = event.variant; // "baseline" | "candidate"
        return { ...sample, [key]: (sample[key] ?? "") + event.text };
    }
    if (event.kind === "sample_error") {
        const failKey = event.variant === "baseline" ? "baselineFailed" : "candidateFailed";
        return { ...sample, [failKey]: true };
    }
    return sample;
}

/**
 * Derive the applied per-request configuration from the Selected_Variant. No
 * candidate model and no override for none/baseline (the AI Agent keeps the
 * Current_Model + Current_System_Prompt); the candidate's `invokeId` as
 * `model_id` and its Optimized_Prompt as `system_prompt_override` otherwise.
 */
export function deriveAppliedConfig(selected: SelectedVariant | null): AppliedConfig {
    if (!selected || selected.kind === "baseline") {
        return { model_id: null, system_prompt_override: null };
    }
    return { model_id: selected.invokeId, system_prompt_override: selected.prompt };
}

/** One side of the before/after pairing view. */
export interface SampleSide {
    label: string;
    answer: string | null;
    failed: boolean;
}

export interface SampleView {
    baseline: SampleSide;
    candidate: SampleSide;
}

/**
 * Derive the before/after pairing view: each present answer is labeled with its
 * variant's Provenance_Label, a failed side reports failure, and each side's
 * answer stands independently of the other's outcome.
 */
export function deriveSampleView(
    sample: SampleState,
    baselineLabel: string,
    candidateLabel: string
): SampleView {
    return {
        baseline: {
            label: baselineLabel,
            answer: sample.baseline ?? null,
            failed: sample.baselineFailed === true,
        },
        candidate: {
            label: candidateLabel,
            answer: sample.candidate ?? null,
            failed: sample.candidateFailed === true,
        },
    };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface PromptOptimizationState {
    /** Per-`targetModelId` optimization panel. */
    models: Record<string, ModelPanel>;
    /** The Current_System_Prompt shown as the Baseline_Variant. */
    baselinePrompt: string;
    /** The presenter's Selected_Variant, or null before any selection. */
    selected: SelectedVariant | null;
    /** Before/after sample answers. */
    sample: SampleState;

    /** Fold one `prompt_opt` event into the per-model panels and sample state. */
    applyEvent(event: PromptOptEvent): void;
    /** Record the Baseline_Variant prompt (from the mounting `_ui` card props). */
    setBaselinePrompt(prompt: string): void;
    /** Record the presenter's selection. */
    select(variant: SelectedVariant): void;
    /** Reset the showcase (a page reload or startNewChat clears the selection). */
    clear(): void;
}

const initialState = (): Pick<
    PromptOptimizationState,
    "models" | "baselinePrompt" | "selected" | "sample"
> => ({
    models: {},
    baselinePrompt: "",
    selected: null,
    sample: {},
});

const stateCreator: StateCreator<PromptOptimizationState> = (set) => ({
    ...initialState(),

    applyEvent: (event) =>
        set((s) => ({
            models: applyModelEvent(s.models, event),
            sample: applySampleEvent(s.sample, event),
        })),
    setBaselinePrompt: (prompt) => set({ baselinePrompt: prompt }),
    select: (variant) => set({ selected: variant }),
    clear: () => set(initialState()),
});

/** App singleton store (React hook). */
export const usePromptOptimizationStore = create<PromptOptimizationState>(stateCreator);

/**
 * Factory for an independent store instance. Each call yields a fresh, isolated
 * state — used to prove per-session isolation (Property 7): the applied config
 * derived from one instance is a function of its own selection alone.
 */
export const createPromptOptimizationStore = () =>
    createStore<PromptOptimizationState>(stateCreator);
