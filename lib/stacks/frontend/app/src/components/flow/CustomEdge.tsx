import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

interface CustomEdgeData {
    status: "pending" | "active" | "completed";
    /** Downstream stage accent; the active edge is drawn in this color. */
    accent?: string;
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
    const accent = data?.accent ?? "#4a9eff";

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
                        <stop offset="0%" stopColor={accent} stopOpacity="0.2" />
                        <stop offset="100%" stopColor={accent} stopOpacity="1" />
                    </linearGradient>
                </defs>
                {/* Soft glow underlay so the live edge reads as energized. */}
                <BaseEdge
                    id={`${id}-glow`}
                    path={edgePath}
                    style={{
                        stroke: accent,
                        strokeWidth: 6,
                        opacity: 0.18,
                        filter: "blur(2px)",
                    }}
                />
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
                <circle r="3.5" fill={accent}>
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
