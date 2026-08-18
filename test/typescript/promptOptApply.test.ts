// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Feature: prompt-optimization-showcase, Property 6: Selection maps to the
 * correct applied per-request configuration — no candidate model and no
 * `system_prompt_override` when nothing is selected or the Baseline_Variant is
 * selected, and the selected candidate's `invoke_id` as `model_id` together
 * with that candidate's Optimized_Prompt as `system_prompt_override` when a
 * Candidate_Variant is selected.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 8.1, 8.2, 8.3
 */

import fc from "fast-check";

import {
    deriveAppliedConfig,
    type SelectedVariant,
} from "../../lib/stacks/frontend/app/src/stores/usePromptOptimizationStore";

const candidateArb: fc.Arbitrary<SelectedVariant> = fc.record({
    kind: fc.constant("candidate" as const),
    modelId: fc.string({ maxLength: 24 }),
    invokeId: fc.string({ minLength: 1, maxLength: 40 }),
    prompt: fc.string({ maxLength: 64 }),
    label: fc.string({ maxLength: 16 }),
    optimizedForModelId: fc.string({ maxLength: 24 }),
});

const baselineArb: fc.Arbitrary<SelectedVariant> = fc.constant({ kind: "baseline" });

const selectionArb: fc.Arbitrary<SelectedVariant | null> = fc.oneof(
    fc.constant(null),
    baselineArb,
    candidateArb
);

describe("Property 6 — selection maps to the correct applied per-request configuration", () => {
    it("none/baseline apply nothing; a candidate applies its invokeId + optimized prompt", () => {
        fc.assert(
            fc.property(selectionArb, (selected) => {
                const config = deriveAppliedConfig(selected);

                if (!selected || selected.kind === "baseline") {
                    // Keep Current_Model + Current_System_Prompt.
                    expect(config).toEqual({ model_id: null, system_prompt_override: null });
                    return;
                }

                // Candidate: invocable id as model_id, Optimized_Prompt as override.
                expect(config.model_id).toBe(selected.invokeId);
                expect(config.system_prompt_override).toBe(selected.prompt);
            }),
            { numRuns: 200 }
        );
    });
});
