// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Pure provenance/attribution derivation for the Prompt Optimization showcase
 * card. Extracted from `PromptOptimizationCard.tsx` — with no React or
 * Cloudscape imports — so Property 5 can exercise the label and attribution
 * logic in isolation.
 *
 * Attribution is deliberate: Bedrock `OptimizePrompt` returns analysis and an
 * optimized prompt ONLY — never a score, latency, or cost. The derived view
 * therefore never carries a Bedrock-attributed metric; any comparison indicator
 * that is not the Before_After_Comparison is a heuristic, and before/after
 * results are attributed to this demo's own sample run.
 */

/** Provenance_Label shown for the Baseline_Variant (Req 4.4). */
export const CURRENT_CONFIG_LABEL = "Current configuration";
/** Any non-before/after comparison indicator is a heuristic, not a Bedrock score (Req 5.2). */
export const HEURISTIC_LABEL = "heuristic";
/** Before/after answers come from this demo's own sample run, not Bedrock (Req 5.3). */
export const SAMPLE_ATTRIBUTION = "this demo's own sample run";
/** What `OptimizePrompt` actually returns — no scores/latency/cost (Req 5.1). */
export const OPTIMIZE_RETURNS_NOTE =
    "Bedrock returns analysis and an optimized prompt only — no evaluation score, latency, or cost.";

/**
 * Input to {@link deriveVariantView}: either the Baseline_Variant, or a
 * Candidate_Variant identified by the model its prompt was optimized for and
 * (optionally) the model it is being paired with when they differ.
 */
export type VariantViewInput =
    | { kind: "baseline" }
    | {
          kind: "candidate";
          /** Model the prompt was optimized for. */
          optimizedForModelId: string;
          optimizedForLabel: string;
          /** Model the prompt is paired with; defaults to the optimized-for model. */
          pairedModelId?: string;
          pairedLabel?: string;
      };

/** The derived provenance + attribution view for one displayed Variant. */
export interface VariantView {
    kind: "baseline" | "candidate";
    /** Human Provenance_Label shown under the Variant. */
    provenanceLabel: string;
    /** True only for a candidate paired with a model other than its optimized-for model. */
    mismatch: boolean;
    /** Label applied to any heuristic (non-before/after) indicator. */
    heuristicLabel: string;
    /** How a before/after result is attributed (never a Bedrock score). */
    sampleAttribution: string;
    /** The card never carries a Bedrock-attributed score/latency/cost. */
    hasBedrockScore: false;
}

/**
 * Pure derivation of a Variant's Provenance_Label and attribution flags. The
 * Baseline is identified as the current configuration; a Candidate is
 * identified by the model its prompt was optimized for; and a candidate prompt
 * paired with a different model yields a mismatch label naming both models. The
 * returned view never exposes a Bedrock-attributed score/latency/cost, labels
 * heuristics as such, and attributes before/after to the feature's own sample
 * generation (Req 4.3–4.6, 5.1–5.3).
 */
export function deriveVariantView(input: VariantViewInput): VariantView {
    const attribution = {
        heuristicLabel: HEURISTIC_LABEL,
        sampleAttribution: SAMPLE_ATTRIBUTION,
        hasBedrockScore: false as const,
    };

    if (input.kind === "baseline") {
        return {
            kind: "baseline",
            provenanceLabel: CURRENT_CONFIG_LABEL,
            mismatch: false,
            ...attribution,
        };
    }

    const pairedModelId = input.pairedModelId ?? input.optimizedForModelId;
    const pairedLabel = input.pairedLabel ?? input.optimizedForLabel;
    const mismatch = pairedModelId !== input.optimizedForModelId;
    const provenanceLabel = mismatch
        ? `Prompt optimized for ${input.optimizedForLabel}, applied to ${pairedLabel}`
        : `Optimized for ${input.optimizedForLabel}`;

    return { kind: "candidate", provenanceLabel, mismatch, ...attribution };
}
