import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import type { AgentNodeData } from "./flow-types";
import { AGENT_COLORS } from "./flow-types";
import type { AgentId } from "@/lib/agentcore-client/types";

type AgentNode = Node<AgentNodeData>;

function StatusIcon({ status }: { status: AgentNodeData["status"] }) {
    if (status === "active") {
        return (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        );
    }
    if (status === "completed") {
        return (
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
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
    return <div className="h-3 w-3 rounded-full border-2 border-current opacity-40" />;
}

export function CustomAgentNode({ data }: NodeProps<AgentNode>) {
    const borderColor =
        data.agentId === "user" ? "#888d94" : (AGENT_COLORS[data.agentId as AgentId] ?? "#888d94");

    const statusColor =
        data.status === "completed" ? "#539d43" : data.status === "active" ? "#0972d3" : "#888d94";

    const thinkingCount = (data.thinkingCount as number) ?? 0;

    return (
        <>
            <Handle type="target" position={Position.Top} className="!bg-gray-400" />
            <div
                className="relative min-w-[180px] rounded-lg bg-white px-4 py-3 shadow-sm"
                style={{ borderLeft: `4px solid ${borderColor}` }}
            >
                {thinkingCount > 0 && (
                    <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white shadow-sm">
                        {thinkingCount}
                    </span>
                )}
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="text-sm font-semibold text-gray-900">{data.label}</div>
                        <div className="mt-0.5 text-xs text-gray-500">{data.description}</div>
                    </div>
                    <div style={{ color: statusColor }}>
                        <StatusIcon status={data.status} />
                    </div>
                </div>
            </div>
            <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
        </>
    );
}
