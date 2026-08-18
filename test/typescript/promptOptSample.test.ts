// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Feature: prompt-optimization-showcase, Property 8: Before/after pairs answers
 * with provenance and isolates a per-variant failure — for any pair of
 * before/after outcomes (each of the Baseline and the chosen Candidate either
 * producing an answer or failing), the paired view labels each present answer
 * with the Provenance_Label of the Variant that produced it, shows a failure
 * state for a failed side, and still shows the other side's answer whenever
 * that side succeeded.
 *
 * Validates: Requirements 7.3, 7.5, 7.6
 */

import fc from "fast-check";

import {
    createPromptOptimizationStore,
    deriveSampleView,
    type PromptOptEvent,
} from "../../lib/stacks/frontend/app/src/stores/usePromptOptimizationStore";

type Variant = "baseline" | "candidate";

type SideOutcome = { outcome: "answer"; chunks: string[] } | { outcome: "fail" };

const sideArb: fc.Arbitrary<SideOutcome> = fc.oneof(
    fc.record({
        outcome: fc.constant("answer" as const),
        chunks: fc.array(fc.string({ maxLength: 16 }), { minLength: 1, maxLength: 3 }),
    }),
    fc.record({ outcome: fc.constant("fail" as const) })
);

/** The `prompt_opt` sample events a single before/after side emits. */
function buildSideEvents(variant: Variant, label: string, side: SideOutcome): PromptOptEvent[] {
    if (side.outcome === "fail") {
        return [
            {
                type: "prompt_opt",
                targetModelId: "",
                modelLabel: label,
                kind: "sample_error",
                text: "",
                variant,
            },
        ];
    }
    return side.chunks.map((text) => ({
        type: "prompt_opt",
        targetModelId: "",
        modelLabel: label,
        kind: "sample",
        text,
        variant,
    }));
}

/** Round-robin merge so the two sides' events interleave. */
function interleave(a: PromptOptEvent[], b: PromptOptEvent[]): PromptOptEvent[] {
    const out: PromptOptEvent[] = [];
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
        if (i < a.length) out.push(a[i]);
        if (i < b.length) out.push(b[i]);
    }
    return out;
}

describe("Property 8 — before/after pairs answers with provenance and isolates a per-variant failure", () => {
    it("labels present answers, shows failure per side, and keeps sides independent", () => {
        fc.assert(
            fc.property(
                sideArb,
                sideArb,
                fc.string({ minLength: 1, maxLength: 16 }),
                fc.string({ minLength: 1, maxLength: 16 }),
                (baseSide, candSide, baselineLabel, candidateLabel) => {
                    const store = createPromptOptimizationStore();
                    const events = interleave(
                        buildSideEvents("baseline", baselineLabel, baseSide),
                        buildSideEvents("candidate", candidateLabel, candSide)
                    );
                    for (const e of events) store.getState().applyEvent(e);

                    const view = deriveSampleView(
                        store.getState().sample,
                        baselineLabel,
                        candidateLabel
                    );

                    // Provenance labels are always the producing variant's label.
                    expect(view.baseline.label).toBe(baselineLabel);
                    expect(view.candidate.label).toBe(candidateLabel);

                    if (baseSide.outcome === "answer") {
                        expect(view.baseline.failed).toBe(false);
                        expect(view.baseline.answer).toBe(baseSide.chunks.join(""));
                    } else {
                        expect(view.baseline.failed).toBe(true);
                        expect(view.baseline.answer).toBeNull();
                    }

                    if (candSide.outcome === "answer") {
                        expect(view.candidate.failed).toBe(false);
                        expect(view.candidate.answer).toBe(candSide.chunks.join(""));
                    } else {
                        expect(view.candidate.failed).toBe(true);
                        expect(view.candidate.answer).toBeNull();
                    }
                }
            ),
            { numRuns: 200 }
        );
    });
});
