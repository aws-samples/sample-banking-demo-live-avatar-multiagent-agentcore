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
};

const CATEGORY_SIZE: Record<ConciergeNodeData["category"], string> = {
    user: "w-[140px]",
    core: "w-[220px]",
    tool: "w-[200px]",
    resource: "w-[190px]",
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
