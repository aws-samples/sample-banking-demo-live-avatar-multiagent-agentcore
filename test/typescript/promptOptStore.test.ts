// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Feature: prompt-optimization-showcase, Property 4: The per-model fold reflects
 * each model's own outcome independently — for any sequence of `prompt_opt`
 * events over any set of Target_Models with any mix of outcomes, the folded
 * store gives each model a panel that reflects only that model's own events
 * (optimized → `succeeded` with analysis+prompt, error → `failed`,
 * invalid_target → `invalid_target`, none → `in_progress`); the selectable
 * Candidate_Variants equal exactly the `succeeded` models, and no model's
 * outcome alters any other model's panel.
 *
 * Validates: Requirements 3.3, 3.4, 3.5, 10.1, 10.2, 10.3, 10.4, 10.5
 */

import fc from "fast-check";

import {
    foldModels,
    selectableCandidateIds,
    type ModelStatus,
    type PromptOptEvent,
} from "../../lib/stacks/frontend/app/src/stores/usePromptOptimizationStore";

type Outcome = "succeeded" | "failed" | "invalid" | "pending";

interface ModelSpec {
    modelId: string;
    label: string;
    outcome: Outcome;
    analysis: string;
    optimized: string;
}

const ev = (
    modelId: string,
    label: string,
    kind: PromptOptEvent["kind"],
    text: string
): PromptOptEvent => ({
    type: "prompt_opt",
    targetModelId: modelId,
    modelLabel: label,
    kind,
    text,
});

/** The `prompt_opt` events a single model emits for its assigned outcome. */
function buildModelEvents(spec: ModelSpec): PromptOptEvent[] {
    switch (spec.outcome) {
        case "succeeded":
            return [
                ev(spec.modelId, spec.label, "analysis", spec.analysis),
                ev(spec.modelId, spec.label, "optimized", spec.optimized),
            ];
        case "failed":
            return [
                ev(spec.modelId, spec.label, "analysis", spec.analysis),
                ev(spec.modelId, spec.label, "error", ""),
            ];
        case "invalid":
            return [ev(spec.modelId, spec.label, "invalid_target", "")];
        case "pending":
            return [ev(spec.modelId, spec.label, "in_progress", "")];
    }
}

/** Round-robin merge so events from different models interleave. */
function interleave(lists: PromptOptEvent[][]): PromptOptEvent[] {
    const out: PromptOptEvent[] = [];
    const max = lists.reduce((m, l) => Math.max(m, l.length), 0);
    for (let i = 0; i < max; i++) {
        for (const l of lists) {
            if (i < l.length) out.push(l[i]);
        }
    }
    return out;
}

const EXPECTED_STATUS: Record<Outcome, ModelStatus> = {
    succeeded: "succeeded",
    failed: "failed",
    invalid: "invalid_target",
    pending: "in_progress",
};

describe("Property 4 — the per-model fold reflects each model's own outcome independently", () => {
    const modelSpecArb: fc.Arbitrary<ModelSpec> = fc.record({
        modelId: fc.string({ minLength: 1, maxLength: 24 }),
        label: fc.string({ maxLength: 12 }),
        outcome: fc.constantFrom<Outcome>("succeeded", "failed", "invalid", "pending"),
        analysis: fc.string({ maxLength: 24 }),
        optimized: fc.string({ maxLength: 24 }),
    });

    it("folds each model's panel from only its own events; candidates == succeeded", () => {
        fc.assert(
            fc.property(
                fc.uniqueArray(modelSpecArb, {
                    minLength: 1,
                    maxLength: 6,
                    selector: (m) => m.modelId,
                }),
                (specs) => {
                    const events = interleave(specs.map(buildModelEvents));
                    const models = foldModels(events);

                    // Exactly one panel per distinct model — no model leaks into another.
                    expect(Object.keys(models).sort()).toEqual(specs.map((s) => s.modelId).sort());

                    for (const spec of specs) {
                        const panel = models[spec.modelId];
                        expect(panel.status).toBe(EXPECTED_STATUS[spec.outcome]);
                        expect(panel.label).toBe(spec.label);

                        if (spec.outcome === "succeeded") {
                            // A succeeded model carries its own analysis and optimized prompt.
                            expect(panel.analysis).toBe(spec.analysis);
                            expect(panel.optimizedPrompt).toBe(spec.optimized);
                        }
                    }

                    // Selectable candidates are exactly the succeeded models.
                    const succeeded = specs
                        .filter((s) => s.outcome === "succeeded")
                        .map((s) => s.modelId)
                        .sort();
                    expect(selectableCandidateIds(models).sort()).toEqual(succeeded);
                }
            ),
            { numRuns: 200 }
        );
    });
});
