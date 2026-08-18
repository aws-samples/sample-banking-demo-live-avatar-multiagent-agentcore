import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

type Status = "idle" | "active" | "completed" | "failed";

export function ConciergeEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
}: EdgeProps) {
    const status = ((data?.status as Status) ?? "idle") as Status;
    const label = typeof data?.label === "string" ? data.label : undefined;

    const [edgePath, labelX, labelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        borderRadius: 12,
    });

    const labelEl = label ? (
        <EdgeLabelRenderer>
            <div
                className="nodrag nopan pointer-events-none absolute rounded border border-slate-600/70 bg-slate-900/90 px-1.5 py-0.5 text-[9px] font-medium text-slate-300 shadow"
                style={{
                    transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                }}
            >
                {label}
            </div>
        </EdgeLabelRenderer>
    ) : null;

    if (status === "active") {
        const gradId = `concierge-grad-${id}`;
        return (
            <>
                <defs>
                    <linearGradient
                        id={gradId}
                        gradientUnits="userSpaceOnUse"
                        x1={sourceX}
                        y1={sourceY}
                        x2={targetX}
                        y2={targetY}
                    >
                        <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#fbbf24" stopOpacity="1" />
                    </linearGradient>
                </defs>
                {/* Dim base */}
                <BaseEdge
                    id={`${id}-base`}
                    path={edgePath}
                    style={{ stroke: "#475569", strokeWidth: 1.25 }}
                />
                {/* Flowing overlay */}
                <BaseEdge
                    id={id}
                    path={edgePath}
                    style={{
                        stroke: `url(#${gradId})`,
                        strokeWidth: 2.5,
                        strokeDasharray: "8 6",
                        strokeLinecap: "round",
                    }}
                    className="concierge-edge-flow"
                />
                {labelEl}
            </>
        );
    }

    const stroke = status === "completed" ? "#34d399" : status === "failed" ? "#f43f5e" : "#475569";
    const width = status === "completed" || status === "failed" ? 1.5 : 1.25;

    return (
        <>
            <BaseEdge
                id={id}
                path={edgePath}
                style={{
                    stroke,
                    strokeWidth: width,
                    transition: "stroke 0.3s ease",
                }}
            />
            {labelEl}
        </>
    );
}
