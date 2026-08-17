import { useConciergeFlowStore } from "@/stores/conciergeFlowStore";
import { FlowPanelShell } from "@/components/common/flow/FlowPanelShell";
import { ConciergeFlowDiagram } from "./ConciergeFlowDiagram";
import { ToolActivityTimeline } from "./ToolActivityTimeline";
import { RunReport } from "./RunReport";

interface ConciergeFlowSidebarProps {
    onClose: () => void;
}

export function ConciergeFlowSidebar({ onClose }: ConciergeFlowSidebarProps) {
    const runtimeActive = useConciergeFlowStore((s) => s.runtimeActive);
    const events = useConciergeFlowStore((s) => s.events);

    return (
        <FlowPanelShell
            title="AgentCore Flow"
            subtitle="Real-time view of runtime, gateway & tool invocations"
            live={runtimeActive}
            diagram={<ConciergeFlowDiagram />}
            report={<RunReport />}
            feed={<ToolActivityTimeline />}
            hasFeed={events.length > 0}
            feedEmpty={<EmptyState />}
            onClose={onClose}
        />
    );
}

function EmptyState() {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-8 text-center">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-500/30 to-orange-500/10" />
            <p className="text-xs font-medium text-slate-300">
                Send a message to see the flow come to life
            </p>
            <p className="text-[11px] text-slate-500">
                Nodes light up as the runtime orchestrates tool calls across the Gateway.
            </p>
        </div>
    );
}
