import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

type Status = "idle" | "active" | "completed";

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

    const [edgePath] = getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        borderRadius: 12,
    });

    const stroke = status === "active" ? "#fbbf24" : status === "completed" ? "#34d399" : "#475569";
    const width = status === "active" ? 2 : 1.25;

    return (
        <>
            <BaseEdge
                id={id}
                path={edgePath}
                style={{
                    stroke,
                    strokeWidth: width,
                    strokeDasharray: status === "active" ? "6 4" : undefined,
                    transition: "stroke 0.3s ease",
                }}
                className={status === "active" ? "concierge-edge-flow" : undefined}
            />
        </>
    );
}
