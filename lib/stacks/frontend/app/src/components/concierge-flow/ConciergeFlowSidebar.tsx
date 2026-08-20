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
        <div className="flex items-center gap-2 border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500">
            <span
                className="inline-block h-2 w-2 flex-none rounded-full bg-gradient-to-br from-amber-500/40 to-orange-500/20"
                aria-hidden
            />
            <span className="truncate">
                Send a message — nodes light up as the runtime calls tools across the Gateway.
            </span>
        </div>
    );
}
