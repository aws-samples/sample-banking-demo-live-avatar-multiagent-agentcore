import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { motion } from "framer-motion";
import type { AgentNodeData } from "./flow-types";
import { AGENT_COLORS, AGENT_ICONS } from "./flow-types";
import type { AgentId } from "@/lib/agentcore-client/types";

type AgentNode = Node<AgentNodeData>;

function StatusBadge({ status, accent }: { status: AgentNodeData["status"]; accent: string }) {
    if (status === "active") {
        return (
            <div
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent"
                style={{ borderColor: accent, borderTopColor: "transparent" }}
            />
        );
    }
    if (status === "completed") {
        return (
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" style={{ color: accent }}>
                <path
                    d="M3.5 8.5L6.5 11.5L12.5 4.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        );
    }
    return <div className="h-2.5 w-2.5 rounded-full border-2 border-slate-500 opacity-50" />;
}

export function CustomAgentNode({ data }: NodeProps<AgentNode>) {
    const isUser = data.agentId === "user";
    const accent = isUser ? "#94a3b8" : (AGENT_COLORS[data.agentId as AgentId] ?? "#94a3b8");
    const icon = AGENT_ICONS[data.agentId];
    const thinkingCount = (data.thinkingCount as number) ?? 0;
    const active = data.status === "active";
    const completed = data.status === "completed";

    return (
        <>
            <Handle
                type="target"
                position={Position.Top}
                className="!h-1.5 !w-1.5 !border-slate-600 !bg-slate-500"
            />

            <motion.div
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25 }}
                className="relative min-w-[210px] rounded-xl border px-3.5 py-3 backdrop-blur-sm transition-all duration-300"
                style={{
                    borderColor: active
                        ? accent
                        : completed
                          ? "rgba(79,209,165,0.5)"
                          : "rgba(71,85,105,0.5)",
                    background: active
                        ? `linear-gradient(135deg, ${accent}22, rgba(15,23,42,0.6))`
                        : "rgba(15,23,42,0.55)",
                    boxShadow: active ? `0 0 0 1px ${accent}, 0 8px 24px -8px ${accent}66` : "none",
                }}
            >
                {active && (
                    <motion.div
                        className="pointer-events-none absolute inset-0 rounded-xl border"
                        style={{ borderColor: accent }}
                        animate={{ opacity: [0.6, 0, 0.6] }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                    />
                )}

                {thinkingCount > 0 && (
                    <span
                        className="absolute -right-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-slate-900 shadow"
                        style={{ background: accent }}
                    >
                        {thinkingCount}
                    </span>
                )}

                <div className="flex items-center gap-3">
                    {/* Icon chip */}
                    <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                        style={{
                            background: isUser ? "rgba(148,163,184,0.15)" : `${accent}1f`,
                            border: `1px solid ${accent}44`,
                        }}
                    >
                        {icon ? (
                            <img
                                src={icon}
                                alt=""
                                className="h-5 w-5 object-contain"
                                style={{ opacity: data.status === "pending" ? 0.5 : 1 }}
                            />
                        ) : (
                            <svg
                                className="h-4 w-4"
                                viewBox="0 0 20 20"
                                fill="none"
                                stroke={accent}
                                strokeWidth="1.8"
                            >
                                <circle cx="10" cy="6" r="3.2" />
                                <path d="M4 16.5c0-3 2.7-5 6-5s6 2 6 5" strokeLinecap="round" />
                            </svg>
                        )}
                    </div>

                    <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold leading-tight text-slate-100">
                            {data.label}
                        </div>
                        {data.description && (
                            <div className="mt-0.5 truncate text-[10.5px] leading-tight text-slate-400">
                                {data.description}
                            </div>
                        )}
                    </div>

                    <div className="shrink-0">
                        <StatusBadge status={data.status} accent={accent} />
                    </div>
                </div>
            </motion.div>

            <Handle
                type="source"
                position={Position.Bottom}
                className="!h-1.5 !w-1.5 !border-slate-600 !bg-slate-500"
            />
        </>
    );
}
