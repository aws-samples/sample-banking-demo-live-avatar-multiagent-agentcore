import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

interface CustomEdgeData {
    status: "pending" | "active" | "completed";
}

export function CustomEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
}: EdgeProps & { data?: CustomEdgeData }) {
    const [edgePath] = getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        borderRadius: 14,
    });

    const status = data?.status ?? "pending";

    if (status === "active") {
        const gradId = `agent-edge-grad-${id}`;
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
                        <stop offset="0%" stopColor="#4a9eff" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#4a9eff" stopOpacity="1" />
                    </linearGradient>
                </defs>
                <BaseEdge
                    id={`${id}-base`}
                    path={edgePath}
                    style={{ stroke: "#334155", strokeWidth: 1.5 }}
                />
                <BaseEdge
                    id={id}
                    path={edgePath}
                    style={{
                        stroke: `url(#${gradId})`,
                        strokeWidth: 2.5,
                        strokeDasharray: "7 5",
                        strokeLinecap: "round",
                    }}
                />
                <circle r="3.5" fill="#4a9eff">
                    <animateMotion dur="1.4s" repeatCount="indefinite" path={edgePath} />
                </circle>
            </>
        );
    }

    const stroke = status === "completed" ? "#4fd1a5" : "#334155";
    const width = status === "completed" ? 1.75 : 1.5;

    return (
        <BaseEdge
            id={id}
            path={edgePath}
            style={{ stroke, strokeWidth: width, transition: "stroke 0.3s ease" }}
        />
    );
}
