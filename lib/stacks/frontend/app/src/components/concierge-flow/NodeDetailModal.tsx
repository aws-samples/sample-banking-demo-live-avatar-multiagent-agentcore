import { AnimatePresence, motion } from "framer-motion";
import { TOOL_META, CORE_NODE_META } from "./flow-types";

interface NodeDetailModalProps {
    nodeId: string | null;
    onClose: () => void;
}

export function NodeDetailModal({ nodeId, onClose }: NodeDetailModalProps) {
    const tool = nodeId ? TOOL_META[nodeId] : undefined;
    const core = nodeId ? CORE_NODE_META[nodeId] : undefined;
    const isTool = Boolean(tool);
    const label = tool?.label ?? core?.label ?? nodeId ?? "";
    const rawName = tool ? nodeId : core?.rawName;
    const description = tool?.description ?? core?.description ?? "No description available.";

    return (
        <AnimatePresence>
            {nodeId && (
                <motion.div
                    key="backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
                    onClick={onClose}
                >
                    <motion.div
                        key="panel"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-label={`${label} details`}
                        className="relative w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-2xl"
                    >
                        <button
                            onClick={onClose}
                            className="absolute right-2 top-2 rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
                            aria-label="Close"
                        >
                            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none">
                                <path
                                    d="M5 5l10 10M15 5L5 15"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                />
                            </svg>
                        </button>
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-amber-400">
                            {isTool ? "MCP Tool" : "AgentCore Component"}
                        </div>
                        <h3 className="text-base font-semibold text-slate-100">{label}</h3>
                        {rawName && (
                            <code className="mt-1 block break-all font-mono text-[10px] text-slate-500">
                                {rawName}
                            </code>
                        )}
                        <p className="mt-3 text-xs leading-relaxed text-slate-300">{description}</p>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
