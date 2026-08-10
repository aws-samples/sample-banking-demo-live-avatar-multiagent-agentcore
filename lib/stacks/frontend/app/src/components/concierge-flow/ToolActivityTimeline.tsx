import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { useConciergeFlowStore } from "@/stores/conciergeFlowStore";
import { TOOL_META } from "./flow-types";
import { ServiceChips } from "@/components/common/ServiceChips";
import { describeTool } from "@/config/toolCatalog";

function fmtElapsed(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Live feed of tool calls beneath the flow diagram.
 *
 * Each row carries AWS-service chips so the services in play are visible
 * without interaction, and expands on click to show what the tool does and the
 * full service list. Expanding in place (rather than opening a modal) keeps the
 * diagram above it visible, which is the point — you are connecting a call in
 * the feed to a node in the graph.
 */
export function ToolActivityTimeline() {
    const events = useConciergeFlowStore((s) => s.events);
    const [expanded, setExpanded] = useState<string | null>(null);

    return (
        <ol className="space-y-1 p-3">
            {events
                .slice()
                .reverse()
                .map((e) => {
                    const tool = describeTool(e.name);
                    const label = TOOL_META[e.name]?.label ?? tool.label;
                    const isRunning = e.status === "running";
                    const elapsed =
                        e.completedAt && e.startedAt
                            ? fmtElapsed(e.completedAt - e.startedAt)
                            : null;
                    const isOpen = expanded === e.toolUseId;

                    return (
                        <li
                            key={e.toolUseId}
                            className="rounded border border-slate-800 bg-slate-900/40"
                        >
                            <button
                                type="button"
                                onClick={() => setExpanded(isOpen ? null : e.toolUseId)}
                                aria-expanded={isOpen}
                                aria-label={`${label} — show AWS services`}
                                className="flex w-full items-center gap-2 border-0 bg-transparent px-2.5 py-1.5 text-left"
                                style={{ cursor: "pointer" }}
                            >
                                <span
                                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                        isRunning ? "animate-pulse bg-amber-400" : "bg-emerald-400"
                                    }`}
                                    aria-hidden
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[11px] font-medium text-slate-200">
                                        {label}
                                    </span>
                                    <span className="mt-1 block">
                                        <ServiceChips tools={[e.name]} max={3} />
                                    </span>
                                </span>
                                <span className="shrink-0 text-[10px] text-slate-500">
                                    {isRunning ? "running…" : (elapsed ?? "done")}
                                </span>
                                <ChevronRight
                                    size={13}
                                    aria-hidden
                                    className="shrink-0 text-slate-500 transition-transform"
                                    style={{ transform: isOpen ? "rotate(90deg)" : "none" }}
                                />
                            </button>

                            <AnimatePresence initial={false}>
                                {isOpen && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.16, ease: "easeOut" }}
                                        className="overflow-hidden"
                                    >
                                        <div className="border-t border-slate-800 px-2.5 py-2">
                                            <p className="text-[11px] leading-relaxed text-slate-400">
                                                {tool.description}
                                            </p>
                                            {tool.services.length > 0 && (
                                                <div className="mt-2">
                                                    <div className="mb-1 text-[9.5px] uppercase tracking-wider text-slate-500">
                                                        AWS services called
                                                    </div>
                                                    <ul className="space-y-0.5">
                                                        {tool.services.map((service) => (
                                                            <li
                                                                key={service.short}
                                                                className="flex items-center gap-1.5 text-[10.5px] text-slate-300"
                                                            >
                                                                <span
                                                                    aria-hidden
                                                                    className="h-1.5 w-1.5 rounded-full"
                                                                    style={{
                                                                        background: service.color,
                                                                    }}
                                                                />
                                                                {service.name}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </li>
                    );
                })}
        </ol>
    );
}
