// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Feature: prompt-optimization-showcase, Property 5: Provenance and attribution
 * labels are correct and never claim Bedrock scores — for any Variant and any
 * model it is paired with, the derived label identifies the Baseline_Variant as
 * the current configuration, identifies a Candidate_Variant by the model its
 * prompt was optimized for, and — when a candidate prompt is paired with a
 * model other than its optimized-for model — produces a mismatch label naming
 * both models; and for any store state, the derived view exposes no indicator
 * attributed to the Bedrock `OptimizePrompt` API as a score, latency, or cost,
 * labels any non-before/after comparison indicator as a heuristic, and
 * attributes any before/after result to the feature's own sample generation.
 *
 * Validates: Requirements 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3
 */

import fc from "fast-check";

import {
    deriveVariantView,
    CURRENT_CONFIG_LABEL,
    HEURISTIC_LABEL,
    SAMPLE_ATTRIBUTION,
    type VariantView,
} from "../../lib/stacks/frontend/app/src/components/chat/promptOptVariantView";

const idArb = fc.string({ minLength: 1, maxLength: 30 });
const labelArb = fc.string({ minLength: 1, maxLength: 24 });

/** No field of the derived view may claim a Bedrock-returned score/latency/cost. */
function assertNoBedrockMetric(view: VariantView): void {
    // The view carries an explicit, always-false marker and no metric field.
    expect(view.hasBedrockScore).toBe(false);
    const keys = Object.keys(view);
    for (const forbidden of ["score", "latency", "cost"]) {
        expect(keys).not.toContain(forbidden);
    }
    // The heuristic + sample attribution are always present and correct so the
    // card never presents an unattributed comparison indicator.
    expect(view.heuristicLabel).toBe(HEURISTIC_LABEL);
    expect(view.heuristicLabel).toBe("heuristic");
    expect(view.sampleAttribution).toBe(SAMPLE_ATTRIBUTION);
    expect(view.sampleAttribution.toLowerCase()).toContain("sample");
}

describe("Property 5 — provenance and attribution labels are correct and never claim Bedrock scores", () => {
    it("labels the Baseline_Variant as the current configuration (Req 4.4)", () => {
        const view = deriveVariantView({ kind: "baseline" });
        expect(view.kind).toBe("baseline");
        expect(view.provenanceLabel).toBe(CURRENT_CONFIG_LABEL);
        expect(view.provenanceLabel.toLowerCase()).toContain("current configuration");
        expect(view.mismatch).toBe(false);
        assertNoBedrockMetric(view);
    });

    it("identifies a consistent Candidate_Variant by its optimized-for model (Req 4.5)", () => {
        fc.assert(
            fc.property(idArb, labelArb, (optimizedForModelId, optimizedForLabel) => {
                const view = deriveVariantView({
                    kind: "candidate",
                    optimizedForModelId,
                    optimizedForLabel,
                });
                expect(view.kind).toBe("candidate");
                expect(view.mismatch).toBe(false);
                // The label names the model the prompt was optimized for.
                expect(view.provenanceLabel).toContain(optimizedForLabel);
                assertNoBedrockMetric(view);
            }),
            { numRuns: 200 }
        );
    });

    it("produces a mismatch label naming both models when paired with a different model (Req 4.6)", () => {
        const distinctPair = fc.tuple(idArb, idArb).filter(([a, b]) => a !== b);

        fc.assert(
            fc.property(
                distinctPair,
                labelArb,
                labelArb,
                ([optimizedForModelId, pairedModelId], optimizedForLabel, pairedLabel) => {
                    const view = deriveVariantView({
                        kind: "candidate",
                        optimizedForModelId,
                        optimizedForLabel,
                        pairedModelId,
                        pairedLabel,
                    });
                    expect(view.mismatch).toBe(true);
                    // The mismatch label names BOTH the optimized-for model and
                    // the model the prompt is being paired with.
                    expect(view.provenanceLabel).toContain(optimizedForLabel);
                    expect(view.provenanceLabel).toContain(pairedLabel);
                    assertNoBedrockMetric(view);
                }
            ),
            { numRuns: 200 }
        );
    });

    it("treats a candidate paired with its own optimized-for model as consistent (no mismatch)", () => {
        fc.assert(
            fc.property(idArb, labelArb, labelArb, (modelId, optimizedForLabel, pairedLabel) => {
                const view = deriveVariantView({
                    kind: "candidate",
                    optimizedForModelId: modelId,
                    optimizedForLabel,
                    pairedModelId: modelId,
                    pairedLabel,
                });
                expect(view.mismatch).toBe(false);
                expect(view.provenanceLabel).toContain(optimizedForLabel);
                assertNoBedrockMetric(view);
            }),
            { numRuns: 200 }
        );
    });
});
