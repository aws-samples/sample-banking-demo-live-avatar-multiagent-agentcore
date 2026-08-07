import { useMemo, useState } from "react";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import Flashbar from "@cloudscape-design/components/flashbar";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import { useResearchState } from "@/hooks/useResearchState";
import { AGENT_PIPELINE, type PipelineAgent } from "@/components/chat/types";
import type { PipelinePhase } from "@/lib/agentcore-client/types";

/** Default research pipeline phase config */
const RESEARCH_PHASES: PhaseConfig[] = [
    { phase: "planning", label: "Planning", description: "Planning research" },
    { phase: "research", label: "Research", description: "Gathering information" },
    {
        phase: "synthesis & report",
        label: "Synthesis & Report",
        description: "Synthesizing findings and generating PDF",
    },
    {
        phase: "evaluation",
        label: "Evaluation",
        description: "Scoring the report against the brief and evidence",
    },
];

interface PhaseConfig {
    phase: PipelinePhase;
    label: string;
    description: string;
}

export interface ProgressBarConfig {
    phases: PhaseConfig[];
    pipeline: PipelineAgent[];
    agentToPhase: Record<string, PipelinePhase>;
}

function computePhaseRanges(phases: PhaseConfig[]): Record<string, [number, number]> {
    const count = phases.length;
    const segmentSize = 100 / count;
    const overlap = count > 1 ? segmentSize * 0.15 : 0;
    const ranges: Record<string, [number, number]> = {};
    phases.forEach((p, i) => {
        const start = Math.max(0, Math.round(i * segmentSize - overlap));
        const end = Math.min(100, Math.round((i + 1) * segmentSize + overlap));
        ranges[p.phase] = [start, end];
    });
    return ranges;
}

const DEFAULT_AGENT_TO_PHASE: Record<string, PipelinePhase> = {
    planner: "planning",
    researcher: "research",
    synthesizer: "synthesis & report",
    evaluator: "evaluation",
};

export function ResearchProgressBar({
    mode,
    config,
}: {
    mode: string;
    config?: ProgressBarConfig;
}) {
    const phases = config?.phases ?? RESEARCH_PHASES;
    const pipeline = config?.pipeline ?? AGENT_PIPELINE;
    const agentToPhase = config?.agentToPhase ?? DEFAULT_AGENT_TO_PHASE;

    const phaseRanges = useMemo(() => computePhaseRanges(phases), [phases]);
    const phaseToAgentIndex = useMemo(() => {
        const map: Record<string, number> = {};
        pipeline.forEach((agent, i) => {
            const phase = agentToPhase[agent.id];
            if (phase) map[phase] = i;
        });
        return map;
    }, [pipeline, agentToPhase]);

    const state = useResearchState(mode);
    const [isDismissed, setIsDismissed] = useState(false);

    const overallProgress = phases.reduce((total, { phase }) => {
        const [rangeStart, rangeEnd] = phaseRanges[phase] ?? [0, 0];
        const rangeSize = rangeEnd - rangeStart;
        const phaseContribution = ((state.phaseProgress[phase] ?? 0) / 100) * rangeSize;
        return total + phaseContribution;
    }, 0);

    const clampedProgress = Math.min(Math.round(overallProgress), 100);

    const activePhase = phases.find(({ phase }) => {
        const agentIndex = phaseToAgentIndex[phase];
        return agentIndex != null && state.activeAgent === pipeline[agentIndex]?.id;
    })?.phase;

    const activeDesc = phases.find((p) => p.phase === activePhase)?.description;

    const isComplete = clampedProgress >= 100;
    const isVisible = state.isActive || isComplete || state.completedPhases.length > 0;

    if (!isVisible || isDismissed) return null;

    return (
        <Flashbar
            items={[
                {
                    id: "research-progress",
                    content: (
                        <SpaceBetween size="xs">
                            <ProgressBar
                                value={clampedProgress}
                                variant="flash"
                                description={
                                    activeDesc
                                        ? `Current phase: ${activeDesc}`
                                        : `${clampedProgress}% complete`
                                }
                                status={isComplete ? "success" : "in-progress"}
                            />
                            <div className="flex justify-between">
                                {phases.map(({ phase, label }) => {
                                    const agentIndex = phaseToAgentIndex[phase];
                                    const color =
                                        agentIndex != null
                                            ? (pipeline[agentIndex]?.color ?? "#888")
                                            : "#888";
                                    const isCompleted = state.completedPhases.includes(phase);
                                    const isActivePhase =
                                        agentIndex != null &&
                                        state.activeAgent === pipeline[agentIndex]?.id;

                                    return (
                                        <div key={phase} className="flex items-center gap-1.5">
                                            <span
                                                className="inline-block h-2.5 w-2.5 rounded-full"
                                                style={{
                                                    backgroundColor: color,
                                                    opacity: isCompleted || isActivePhase ? 1 : 0.3,
                                                }}
                                            />
                                            <Box
                                                variant="small"
                                                color={
                                                    isCompleted
                                                        ? "text-status-success"
                                                        : isActivePhase
                                                          ? "text-status-info"
                                                          : "text-body-secondary"
                                                }
                                                fontWeight={isActivePhase ? "bold" : "normal"}
                                            >
                                                {label}
                                            </Box>
                                        </div>
                                    );
                                })}
                            </div>
                        </SpaceBetween>
                    ),
                    type: isComplete ? "success" : "in-progress",
                    dismissible: true,
                    dismissLabel: "Dismiss",
                    onDismiss: () => setIsDismissed(true),
                },
            ]}
        />
    );
}
