import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { motion } from "framer-motion";
import type { ConciergeNodeData } from "./flow-types";

type ConciergeNodeType = Node<ConciergeNodeData>;

const ACTIVITY_STYLES: Record<
    ConciergeNodeData["activity"],
    { ring: string; border: string; bg: string; iconOpacity: number }
> = {
    idle: {
        ring: "ring-0",
        border: "border-slate-700/60",
        bg: "bg-slate-900/40",
        iconOpacity: 0.45,
    },
    active: {
        ring: "ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-900",
        border: "border-amber-400",
        bg: "bg-gradient-to-br from-amber-500/20 to-orange-500/10",
        iconOpacity: 1,
    },
    completed: {
        ring: "ring-1 ring-emerald-400/60",
        border: "border-emerald-400/80",
        bg: "bg-gradient-to-br from-emerald-500/10 to-slate-900/40",
        iconOpacity: 0.9,
    },
    // Terminal error state — only the A2A node can reach this today (Req 9.4).
    failed: {
        ring: "ring-1 ring-rose-500/70",
        border: "border-rose-500/80",
        bg: "bg-gradient-to-br from-rose-500/15 to-slate-900/40",
        iconOpacity: 0.9,
    },
};

const CATEGORY_SIZE: Record<ConciergeNodeData["category"], string> = {
    user: "w-[140px]",
    core: "w-[220px]",
    tool: "w-[200px]",
    resource: "w-[190px]",
    a2a: "w-[230px]",
    prompt_opt: "w-[220px]",
};

export function ConciergeNode({ data }: NodeProps<ConciergeNodeType>) {
    const style = ACTIVITY_STYLES[data.activity];
    const size = CATEGORY_SIZE[data.category];
    const showHandles = data.category !== "user";

    return (
        <>
            {showHandles && (
                <Handle
                    type="target"
                    position={Position.Top}
                    className="!bg-slate-600 !border-slate-500 !w-1.5 !h-1.5"
                />
            )}

            <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25 }}
                role="group"
                aria-label={`${data.label}${data.sublabel ? `, ${data.sublabel}` : ""}, status: ${data.activity}`}
                aria-busy={data.activity === "active"}
                data-status={data.activity}
                className={`relative ${size} cursor-pointer rounded-lg border ${style.border} ${style.bg} ${style.ring} px-2.5 py-2 backdrop-blur-sm transition-all duration-300 hover:brightness-125`}
            >
                {data.activity === "active" && (
                    <motion.div
                        className="pointer-events-none absolute inset-0 rounded-lg border-2 border-amber-400"
                        animate={{ opacity: [0.6, 0, 0.6] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                    />
                )}

                {(data.callCount ?? 0) > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-slate-900 shadow">
                        {data.callCount}
                    </span>
                )}

                <div className="flex items-center gap-2">
                    {data.icon ? (
                        <img
                            src={data.icon}
                            alt=""
                            className="h-8 w-8 shrink-0 object-contain"
                            style={{ opacity: style.iconOpacity }}
                        />
                    ) : (
                        <div className="h-8 w-8 shrink-0 rounded bg-slate-700/50" />
                    )}
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-semibold leading-tight text-slate-100">
                            {data.label}
                        </div>
                        {data.sublabel && (
                            <div className="truncate text-[9px] leading-tight text-slate-400">
                                {data.sublabel}
                            </div>
                        )}
                    </div>
                </div>

                {data.identityCarried && (
                    <div
                        className="mt-1.5 flex items-center gap-1 rounded border border-sky-400/50 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-medium text-sky-300"
                        role="status"
                        aria-label="Customer identity carried across the A2A hop"
                    >
                        <svg
                            className="h-2.5 w-2.5 shrink-0"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            aria-hidden="true"
                        >
                            <path
                                fillRule="evenodd"
                                d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm2.5 8V5.5a2.5 2.5 0 00-5 0V9h5z"
                                clipRule="evenodd"
                            />
                        </svg>
                        <span className="truncate">Identity carried</span>
                    </div>
                )}
            </motion.div>

            {showHandles && (
                <Handle
                    type="source"
                    position={Position.Bottom}
                    className="!bg-slate-600 !border-slate-500 !w-1.5 !h-1.5"
                />
            )}
        </>
    );
}
