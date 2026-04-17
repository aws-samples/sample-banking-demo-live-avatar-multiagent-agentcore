import { motion } from "framer-motion";
import { useConciergeFlowStore } from "@/stores/conciergeFlowStore";
import { ConciergeFlowDiagram } from "./ConciergeFlowDiagram";
import { ToolActivityTimeline } from "./ToolActivityTimeline";

interface ConciergeFlowSidebarProps {
    onClose: () => void;
}

export function ConciergeFlowSidebar({ onClose }: ConciergeFlowSidebarProps) {
    const runtimeActive = useConciergeFlowStore((s) => s.runtimeActive);
    const events = useConciergeFlowStore((s) => s.events);

    return (
        <motion.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            className="flex h-full w-[540px] shrink-0 flex-col border-l border-slate-800 bg-slate-950"
            aria-label="AgentCore flow diagram"
        >
            <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span
                            className={`inline-block h-2 w-2 rounded-full ${
                                runtimeActive ? "animate-pulse bg-amber-400" : "bg-slate-600"
                            }`}
                            aria-hidden
                        />
                        <h2 className="text-sm font-semibold text-slate-100">AgentCore Flow</h2>
                        <span className="text-[10px] uppercase tracking-wider text-slate-500">
                            {runtimeActive ? "Live" : "Idle"}
                        </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">
                        Real-time view of runtime, gateway & tool invocations
                    </p>
                </div>
                <button
                    onClick={onClose}
                    className="rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
                    aria-label="Close flow diagram"
                >
                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path
                            d="M5 5l10 10M15 5L5 15"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                        />
                    </svg>
                </button>
            </header>

            <div className="relative flex-1 border-b border-slate-800">
                <ConciergeFlowDiagram />
            </div>

            <div className="h-[35%] min-h-[120px] flex-none overflow-y-auto">
                {events.length === 0 ? <EmptyState /> : <ToolActivityTimeline />}
            </div>
        </motion.aside>
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
