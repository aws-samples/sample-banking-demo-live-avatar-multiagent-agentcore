// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from "react";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Badge from "@cloudscape-design/components/badge";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import RadioGroup from "@cloudscape-design/components/radio-group";
import {
    usePromptOptimizationStore,
    deriveSampleView,
    targetModelById,
    type ModelPanel,
    type ModelStatus,
    type SelectedVariant,
} from "@/stores/usePromptOptimizationStore";
import {
    deriveVariantView,
    CURRENT_CONFIG_LABEL,
    HEURISTIC_LABEL,
    SAMPLE_ATTRIBUTION,
    OPTIMIZE_RETURNS_NOTE,
} from "./promptOptVariantView";

// Re-export the pure provenance/attribution helper so the card remains the
// public entry point while Property 5 imports it from the pure module.
export {
    deriveVariantView,
    CURRENT_CONFIG_LABEL,
    HEURISTIC_LABEL,
    SAMPLE_ATTRIBUTION,
    OPTIMIZE_RETURNS_NOTE,
    type VariantView,
    type VariantViewInput,
} from "./promptOptVariantView";

/**
 * The Bedrock Prompt Optimization showcase, rendered INLINE IN THE CHAT.
 *
 * A Presenter takes the AI Agent's Current_System_Prompt and, per verified
 * target model, streams `OptimizePrompt`'s analysis then the model-tailored
 * optimized prompt into this card. It reads live per-model state from
 * {@link usePromptOptimizationStore} (fed by `prompt_opt` events), shows the
 * Baseline_Variant beside each Candidate_Variant with a Provenance_Label, lets
 * the Presenter run one synthetic before/after sample, then select and apply a
 * Variant to the live session.
 *
 * Attribution is deliberate: `OptimizePrompt` returns analysis + an optimized
 * prompt ONLY — never a score, latency, or cost. So this card never presents a
 * number as a Bedrock-returned metric; any comparison indicator that is not the
 * Before_After_Comparison is labeled a heuristic, and before/after answers are
 * attributed to this demo's own sample run. The label/attribution derivation is
 * factored into the pure {@link deriveVariantView} helper so it is property
 * testable without React.
 */

interface PromptOptimizationCardProps {
    /** Optional title override for the card header. */
    title?: string;
    /** Wired by the chat renderer to invoke the orchestrator (e.g. optimize_sample). */
    onAction?: (action: string, data: unknown) => void;
}

const STATUS_TO_INDICATOR: Record<
    ModelStatus,
    { type: "loading" | "success" | "error" | "warning"; text: string }
> = {
    in_progress: { type: "loading", text: "Optimizing…" },
    succeeded: { type: "success", text: "Optimized" },
    failed: { type: "error", text: "Failed" },
    invalid_target: { type: "warning", text: "Invalid target" },
};

const BASELINE_KEY = "__baseline__";

export function PromptOptimizationCard({
    title,
    onAction,
}: PromptOptimizationCardProps): JSX.Element {
    const models = usePromptOptimizationStore((s) => s.models);
    const baselinePrompt = usePromptOptimizationStore((s) => s.baselinePrompt);
    const selected = usePromptOptimizationStore((s) => s.selected);
    const sample = usePromptOptimizationStore((s) => s.sample);
    const select = usePromptOptimizationStore((s) => s.select);

    // Local pending selection; nothing applies to the session until the
    // Presenter presses Apply (Req 6.2). Applying commits it to the store,
    // where subsequent chatbot requests read it (see useChatEngine).
    const [pendingKey, setPendingKey] = useState<string | null>(null);

    const modelIds = useMemo(() => Object.keys(models), [models]);
    const succeededIds = useMemo(
        () => modelIds.filter((id) => models[id].status === "succeeded"),
        [modelIds, models]
    );

    const baselineView = deriveVariantView({ kind: "baseline" });

    /** Build a Candidate SelectedVariant from a succeeded model panel. */
    const candidateFor = (targetModelId: string): SelectedVariant | null => {
        const panel = models[targetModelId];
        const info = targetModelById(targetModelId);
        if (!panel || panel.status !== "succeeded" || !info) return null;
        return {
            kind: "candidate",
            modelId: targetModelId,
            invokeId: info.invokeId,
            prompt: panel.optimizedPrompt ?? "",
            label: panel.label,
            optimizedForModelId: targetModelId,
        };
    };

    const apply = (): void => {
        if (!pendingKey) return;
        if (pendingKey === BASELINE_KEY) {
            select({ kind: "baseline" });
            return;
        }
        const candidate = candidateFor(pendingKey);
        if (candidate) select(candidate);
    };

    const runSample = (targetModelId: string): void => {
        const candidate = candidateFor(targetModelId);
        if (!candidate || candidate.kind !== "candidate") return;
        onAction?.("optimize_sample", {
            candidate_model_id: candidate.invokeId,
            candidate_prompt: candidate.prompt,
            candidate_label: candidate.label,
        });
    };

    const appliedLabel =
        selected?.kind === "candidate"
            ? selected.label
            : selected?.kind === "baseline"
              ? CURRENT_CONFIG_LABEL
              : null;

    const sampleView = deriveSampleView(
        sample,
        CURRENT_CONFIG_LABEL,
        selected?.kind === "candidate" ? selected.label : "Candidate"
    );
    const hasSample =
        sampleView.baseline.answer !== null ||
        sampleView.candidate.answer !== null ||
        sampleView.baseline.failed ||
        sampleView.candidate.failed;

    const radioItems = [
        { value: BASELINE_KEY, label: `Baseline — ${CURRENT_CONFIG_LABEL}` },
        ...succeededIds.map((id) => ({
            value: id,
            label: `${models[id].label} — ${
                deriveVariantView({
                    kind: "candidate",
                    optimizedForModelId: id,
                    optimizedForLabel: models[id].label,
                }).provenanceLabel
            }`,
        })),
    ];

    return (
        <div className="my-3">
            <Container
                header={
                    <Header
                        variant="h2"
                        description="Optimize the AI Agent's system prompt for each target model, compare, then apply one to this session."
                    >
                        {title || "Prompt Optimization"}
                    </Header>
                }
            >
                <SpaceBetween size="l">
                    {/* Baseline_Variant — the current configuration (Req 4.1, 4.4). */}
                    <VariantBlock
                        heading="Baseline"
                        provenanceLabel={baselineView.provenanceLabel}
                        badgeColor="grey"
                        body={baselinePrompt}
                        bodyLabel="System prompt"
                    />

                    {/* Per-model analysis → optimized prompt with distinct states (Req 3, 10). */}
                    {modelIds.length === 0 ? (
                        <Box color="text-body-secondary" fontSize="body-s">
                            Waiting for optimization results…
                        </Box>
                    ) : (
                        modelIds.map((id) => (
                            <ModelBlock
                                key={id}
                                targetModelId={id}
                                panel={models[id]}
                                onRunSample={() => runSample(id)}
                            />
                        ))
                    )}

                    {/* Attribution note: OptimizePrompt returns no metrics (Req 5.1, 5.2). */}
                    <Box color="text-body-secondary" fontSize="body-s">
                        {OPTIMIZE_RETURNS_NOTE} Any comparison indicator that is not the sample run
                        is a {HEURISTIC_LABEL}.
                    </Box>

                    {/* Optional before/after, attributed to this demo's own sample run (Req 7, 5.3). */}
                    {hasSample ? (
                        <div>
                            <Box variant="h4" margin={{ bottom: "xs" }}>
                                Before / after — {SAMPLE_ATTRIBUTION}
                            </Box>
                            <SpaceBetween size="s">
                                <SampleSideBlock side={sampleView.baseline} />
                                <SampleSideBlock side={sampleView.candidate} />
                            </SpaceBetween>
                        </div>
                    ) : null}

                    {/* Human-in-the-loop selection + apply (Req 6, 8.5). */}
                    <div>
                        <Box variant="h4" margin={{ bottom: "xs" }}>
                            Select a variant to apply
                        </Box>
                        <RadioGroup
                            value={pendingKey}
                            onChange={({ detail }) => setPendingKey(detail.value)}
                            items={radioItems}
                            ariaLabel="Select the variant to apply to this session"
                        />
                    </div>

                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            {appliedLabel ? (
                                <StatusIndicator type="success">
                                    Applied to this session: {appliedLabel}
                                </StatusIndicator>
                            ) : null}
                            <Button variant="primary" disabled={!pendingKey} onClick={apply}>
                                Apply to session
                            </Button>
                        </SpaceBetween>
                    </Box>
                </SpaceBetween>
            </Container>
        </div>
    );
}

interface VariantBlockProps {
    heading: string;
    provenanceLabel: string;
    badgeColor: "grey" | "green" | "blue" | "red";
    body: string;
    bodyLabel: string;
}

/** A labeled prompt block (baseline or a model's optimized prompt). */
function VariantBlock({
    heading,
    provenanceLabel,
    badgeColor,
    body,
    bodyLabel,
}: VariantBlockProps): JSX.Element {
    return (
        <div
            className="rounded-md p-3"
            style={{ border: "1px solid var(--glass-border)", background: "var(--glass-bg)" }}
        >
            <SpaceBetween size="xs">
                <div className="flex items-center gap-2">
                    <Box variant="h4">{heading}</Box>
                    <Badge color={badgeColor}>{provenanceLabel}</Badge>
                </div>
                <Box color="text-body-secondary" fontSize="body-s">
                    {bodyLabel}
                </Box>
                <Box fontSize="body-s">
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs">{body}</pre>
                </Box>
            </SpaceBetween>
        </div>
    );
}

interface ModelBlockProps {
    targetModelId: string;
    panel: ModelPanel;
    onRunSample: () => void;
}

/** One target model's streaming analysis, optimized prompt, and per-model state. */
function ModelBlock({ targetModelId, panel, onRunSample }: ModelBlockProps): JSX.Element {
    const indicator = STATUS_TO_INDICATOR[panel.status];
    const view = deriveVariantView({
        kind: "candidate",
        optimizedForModelId: targetModelId,
        optimizedForLabel: panel.label,
    });

    return (
        <div
            className="rounded-md p-3"
            style={{ border: "1px solid var(--glass-border)", background: "var(--glass-bg)" }}
        >
            <SpaceBetween size="xs">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Box variant="h4">{panel.label}</Box>
                        <Badge color="blue">{view.provenanceLabel}</Badge>
                    </div>
                    <StatusIndicator type={indicator.type}>{indicator.text}</StatusIndicator>
                </div>

                {panel.analysis ? (
                    <div>
                        <Box color="text-body-secondary" fontSize="body-s">
                            Analysis
                        </Box>
                        <Box fontSize="body-s">{panel.analysis}</Box>
                    </div>
                ) : null}

                {panel.optimizedPrompt ? (
                    <div>
                        <Box color="text-body-secondary" fontSize="body-s">
                            Optimized prompt
                        </Box>
                        <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                            {panel.optimizedPrompt}
                        </pre>
                    </div>
                ) : null}

                {panel.status === "succeeded" ? (
                    <Box>
                        <Button onClick={onRunSample}>Run sample question</Button>
                    </Box>
                ) : null}
            </SpaceBetween>
        </div>
    );
}

/** One side of the before/after pairing, each attributed to its variant. */
function SampleSideBlock({
    side,
}: {
    side: { label: string; answer: string | null; failed: boolean };
}): JSX.Element {
    return (
        <div
            className="rounded p-2"
            style={{ border: "1px solid var(--glass-border)", background: "var(--glass-bg)" }}
        >
            <div className="mb-1 flex items-center gap-2">
                <Box variant="awsui-key-label">{side.label}</Box>
                {side.failed ? <StatusIndicator type="error">Sample failed</StatusIndicator> : null}
            </div>
            {side.answer !== null ? <Box fontSize="body-s">{side.answer}</Box> : null}
        </div>
    );
}
