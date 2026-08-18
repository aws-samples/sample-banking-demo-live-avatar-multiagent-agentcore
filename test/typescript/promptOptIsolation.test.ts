// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Feature: prompt-optimization-showcase, Property 7: Applied configuration is
 * isolated per session — for any two independent session stores holding
 * distinct selections, the applied request configuration derived from one store
 * never depends on or changes the other store's selection; each session's
 * applied `(model, prompt-override)` is a function of its own selection alone.
 *
 * Validates: Requirements 8.4, 12.6
 */

import fc from "fast-check";

import {
    createPromptOptimizationStore,
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

const variantArb: fc.Arbitrary<SelectedVariant> = fc.oneof(
    fc.constant<SelectedVariant>({ kind: "baseline" }),
    candidateArb
);

describe("Property 7 — applied configuration is isolated per session", () => {
    it("each store's applied config is a function of its own selection alone", () => {
        fc.assert(
            fc.property(variantArb, variantArb, (selA, selB) => {
                const a = createPromptOptimizationStore();
                const b = createPromptOptimizationStore();

                // Independent instances, not the same singleton.
                expect(a).not.toBe(b);

                a.getState().select(selA);
                b.getState().select(selB);

                const configA = deriveAppliedConfig(a.getState().selected);
                const configB = deriveAppliedConfig(b.getState().selected);

                // Each store's config matches its own selection alone.
                expect(configA).toEqual(deriveAppliedConfig(selA));
                expect(configB).toEqual(deriveAppliedConfig(selB));

                // Selecting on B never changes A's selection or applied config.
                b.getState().select(selA);
                expect(a.getState().selected).toEqual(selA);
                expect(deriveAppliedConfig(a.getState().selected)).toEqual(configA);
            }),
            { numRuns: 200 }
        );
    });
});
