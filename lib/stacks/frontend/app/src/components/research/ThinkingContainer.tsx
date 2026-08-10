import { useEffect, useRef, useState } from "react";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Badge from "@cloudscape-design/components/badge";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import { useResearchState } from "@/hooks/useResearchState";
import { useChatStore } from "@/stores/chatStore";
import { AGENT_PIPELINE, type PipelineAgent } from "@/components/chat/types";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import type { AgentId } from "@/lib/agentcore-client/types";
import { ServiceChips } from "@/components/common/ServiceChips";

const HEARTBEAT_MESSAGES: Partial<Record<AgentId, string[]>> = {
    planner: [
        "Analyzing main research question...",
        "Breaking question down into sub-questions...",
        "Evaluating importance of each sub-question...",
        "Organizing sub-questions for logical flow...",
    ],
    researcher: [
        "Gathering relevant information...",
        "Searching for authoritative sources...",
        "Analyzing data from multiple perspectives...",
        "Evaluating credibility of information...",
        "Documenting findings with citations...",
    ],
    synthesizer: [
        "Identifying key patterns and themes...",
        "Connecting related findings...",
        "Organizing insights into coherent structure...",
        "Evaluating strength of evidence...",
        "Drawing meaningful conclusions...",
        "Generating PDF report...",
    ],
    menu_designer: [
        "Selecting matching products...",
        "Generating product imagery...",
        "Organizing catalog sections...",
        "Compiling catalog layout...",
    ],
    menu_pdf_writer: [
        "Formatting catalog PDF...",
        "Embedding product imagery...",
        "Finalizing layout...",
    ],
};

function TypingDots() {
    return (
        <span className="inline-flex gap-0.5">
            <span className="animate-bounce text-gray-400" style={{ animationDelay: "0ms" }}>
                .
            </span>
            <span className="animate-bounce text-gray-400" style={{ animationDelay: "150ms" }}>
                .
            </span>
            <span className="animate-bounce text-gray-400" style={{ animationDelay: "300ms" }}>
                .
            </span>
        </span>
    );
}

function AgentHeader({
    name,
    color,
    isActive,
    tools,
}: {
    name: string;
    color: string;
    isActive: boolean;
    /** Tool keys this agent called, rendered as AWS-service chips. */
    tools: string[];
}) {
    return (
        <span className="flex flex-wrap items-center gap-2">
            <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: color }}
            />
            <span>{name}</span>
            {isActive && <Badge color="blue">Active</Badge>}
            {/* Services this step exercised, so the header answers "what did
                this actually call?" without expanding the section. */}
            <ServiceChips tools={tools} max={4} size="sm" />
        </span>
    );
}

export function ThinkingContainer({
    mode,
    pipeline,
}: {
    mode: string;
    pipeline?: PipelineAgent[];
}) {
    const agents = pipeline ?? AGENT_PIPELINE;
    const state = useResearchState(mode);
    const bottomRef = useRef<HTMLDivElement>(null);
    const [expandedByAgent, setExpandedByAgent] = useState<Record<string, boolean>>({});
    const lastActivityRef = useRef<Record<string, number>>({});

    // Heartbeat: generate synthetic thinking messages when agent is silent
    useEffect(() => {
        if (!state.isActive || !state.activeAgent) return;
        // Track real activity timestamps
        lastActivityRef.current[state.activeAgent] = Date.now();

        const interval = setInterval(() => {
            const agent = state.activeAgent;
            if (!agent) return;
            const lastActivity = lastActivityRef.current[agent] ?? 0;
            if (Date.now() - lastActivity > 6000) {
                const messages = HEARTBEAT_MESSAGES[agent] ?? ["Still working..."];
                const message = messages[Math.floor(Math.random() * messages.length)];
                useChatStore
                    .getState()
                    .dispatchResearch(mode, { type: "THINKING", agent, content: message });
                lastActivityRef.current[agent] = Date.now();
            }
        }, 8000);

        return () => clearInterval(interval);
    }, [state.isActive, state.activeAgent, mode]);

    // Track real thinking traces as activity
    useEffect(() => {
        if (state.activeAgent && state.thinkingTraces.length > 0) {
            lastActivityRef.current[state.activeAgent] = Date.now();
        }
    }, [state.thinkingTraces.length, state.activeAgent]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [state.thinkingTraces.length]);

    useEffect(() => {
        if (!state.activeAgent) return;
        setExpandedByAgent((prev) => ({
            ...prev,
            [state.activeAgent as AgentId]: true,
        }));
    }, [state.activeAgent]);

    const tracesByAgent = agents.reduce(
        (acc, agent) => {
            acc[agent.id] = state.thinkingTraces.filter((t) => t.agent === agent.id);
            return acc;
        },
        {} as Record<AgentId, typeof state.thinkingTraces>
    );

    const agentsWithTraces = agents.filter(
        (agent) => tracesByAgent[agent.id].length > 0 || state.activeAgent === agent.id
    );

    if (agentsWithTraces.length === 0) {
        return null;
    }

    return (
        <SpaceBetween size="s">
            {agentsWithTraces.map((agent) => {
                const isActive = state.activeAgent === agent.id;
                const traces = tracesByAgent[agent.id];
                const isExpanded = expandedByAgent[agent.id] || isActive;

                return (
                    <ExpandableSection
                        key={agent.id}
                        expanded={isExpanded}
                        onChange={({ detail }) =>
                            setExpandedByAgent((prev) => ({
                                ...prev,
                                [agent.id]: detail.expanded,
                            }))
                        }
                        variant="container"
                        headerText={
                            <AgentHeader
                                name={agent.name}
                                color={agent.color}
                                isActive={isActive}
                                tools={Object.keys(state.toolsByAgent[agent.id] ?? {})}
                            />
                        }
                    >
                        <div className="max-h-[200px] space-y-2 overflow-y-auto">
                            {traces.map((trace, i) => (
                                <div key={i} className="flex gap-1.5 text-sm text-gray-600">
                                    <span
                                        className="mt-1.5 mr-0.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                                        style={{ backgroundColor: agent.color }}
                                    />
                                    <div className="min-w-0 flex-1 [&_.markdown-body]:text-sm [&_.markdown-body]:leading-snug">
                                        <MarkdownRenderer content={trace.content} />
                                    </div>
                                </div>
                            ))}
                            {isActive && (
                                <Box variant="p" color="text-body-secondary" fontSize="body-s">
                                    <span
                                        className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full"
                                        style={{ backgroundColor: agent.color }}
                                    />
                                    Thinking <TypingDots />
                                </Box>
                            )}
                        </div>
                        <div ref={isActive ? bottomRef : undefined} />
                    </ExpandableSection>
                );
            })}
        </SpaceBetween>
    );
}
