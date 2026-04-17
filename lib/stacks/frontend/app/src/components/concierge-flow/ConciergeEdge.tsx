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
            </>
        );
    }

    const stroke = status === "completed" ? "#34d399" : "#475569";
    const width = status === "completed" ? 1.5 : 1.25;

    return (
        <BaseEdge
            id={id}
            path={edgePath}
            style={{
                stroke,
                strokeWidth: width,
                transition: "stroke 0.3s ease",
            }}
        />
    );
}
