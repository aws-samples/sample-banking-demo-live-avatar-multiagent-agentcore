import { BaseEdge, getStraightPath, type EdgeProps } from "@xyflow/react";

interface CustomEdgeData {
    status: "pending" | "active" | "completed";
}

export function CustomEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    data,
}: EdgeProps & { data?: CustomEdgeData }) {
    const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });

    const status = data?.status ?? "pending";

    const strokeColor =
        status === "completed" ? "#539d43" : status === "active" ? "#0972d3" : "#d1d5db";

    return (
        <>
            <BaseEdge
                id={id}
                path={edgePath}
                style={{
                    stroke: strokeColor,
                    strokeWidth: 2,
                    strokeDasharray: status === "active" ? "6 4" : undefined,
                }}
            />
            {status === "active" && (
                <circle r="3" fill="#0972d3">
                    <animateMotion dur="1.5s" repeatCount="indefinite" path={edgePath} />
                </circle>
            )}
        </>
    );
}
