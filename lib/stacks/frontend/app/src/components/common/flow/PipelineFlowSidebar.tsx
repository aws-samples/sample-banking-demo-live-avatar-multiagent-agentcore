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
        <div className="flex items-center gap-2 border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500">
            <span
                className="inline-block h-2 w-2 flex-none rounded-full bg-gradient-to-br from-amber-500/40 to-orange-500/20"
                aria-hidden
            />
            <span className="truncate">
                Run the pipeline — nodes light up as agents call tools across the Gateway.
            </span>
        </div>
    );
}
