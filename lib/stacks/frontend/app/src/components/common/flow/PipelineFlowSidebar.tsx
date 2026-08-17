import type { ReactNode } from "react";
import { PanelRight, PanelRightClose } from "lucide-react";
import { useResearchState } from "@/hooks/useResearchState";
import { useConciergeFlowStore } from "@/stores/conciergeFlowStore";
import { AgentFlowVisualization, type FlowConfig } from "@/components/flow/AgentFlowVisualization";
import {
    ResearchProgressBar,
    type ProgressBarConfig,
} from "@/components/research/ResearchProgressBar";
import { RunReport } from "@/components/concierge-flow/RunReport";
import { ToolActivityTimeline } from "@/components/concierge-flow/ToolActivityTimeline";
import { FlowPanelShell } from "./FlowPanelShell";

/**
 * Right-rail flow panel for the pipeline experiences (Deep Research Agent and
 * AI Assistant), built on the same `FlowPanelShell` as the AI Agent's
 * "AgentCore Flow" so all three read, move and frame identically.
 *
 * The diagram is the mode-scoped pipeline graph; the Run Report and tool feed
 * come from the shared concierge flow store, which `useChatEngine` populates
 * for every mode — so a research or catalog run drives the same live metrics
 * and activity feed the AI Agent shows.
 */

interface PipelineFlowSidebarProps {
    mode: string;
    title: string;
    subtitle: string;
    collapsed: boolean;
    onToggle: () => void;
    flowConfig?: FlowConfig;
    progressConfig?: ProgressBarConfig;
    /** Experience-specific content below the feed (e.g. catalog summary). */
    extra?: ReactNode;
}

export function PipelineFlowSidebar({
    mode,
    title,
    subtitle,
    collapsed,
    onToggle,
    flowConfig,
    progressConfig,
    extra,
}: PipelineFlowSidebarProps): JSX.Element {
    const research = useResearchState(mode);
    const events = useConciergeFlowStore((s) => s.events);

    if (collapsed) {
        return (
            <div className="flex h-full w-full min-w-0 flex-col items-center border-l border-slate-800 bg-slate-950 py-3">
                <button
                    onClick={onToggle}
                    className="rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
                    aria-label="Expand flow panel"
                    title="Expand"
                >
                    <PanelRight className="h-4 w-4" />
                </button>
            </div>
        );
    }

    const collapseAction = (
        <button
            onClick={onToggle}
            className="rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
            aria-label="Collapse flow panel"
            title="Collapse"
        >
            <PanelRightClose className="h-4 w-4" />
        </button>
    );

    return (
        <FlowPanelShell
            title={title}
            subtitle={subtitle}
            live={research.isActive}
            banner={<ResearchProgressBar mode={mode} config={progressConfig} />}
            diagram={<AgentFlowVisualization mode={mode} config={flowConfig} fill />}
            report={<RunReport />}
            feed={<ToolActivityTimeline />}
            hasFeed={events.length > 0}
            feedEmpty={<FeedEmptyState />}
            action={collapseAction}
            extra={extra}
        />
    );
}

function FeedEmptyState(): JSX.Element {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-8 text-center">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-500/30 to-orange-500/10" />
            <p className="text-xs font-medium text-slate-300">
                Run the pipeline to see the flow come to life
            </p>
            <p className="text-[11px] text-slate-500">
                Nodes light up as each agent orchestrates tool calls across the Gateway.
            </p>
        </div>
    );
}
