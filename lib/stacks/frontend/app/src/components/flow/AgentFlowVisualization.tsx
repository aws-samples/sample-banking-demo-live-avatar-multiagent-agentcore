import { useMemo, useState, useCallback } from "react";
import {
    ReactFlow,
    Background,
    Controls,
    ReactFlowProvider,
    type Node,
    type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Box from "@cloudscape-design/components/box";
import { useResearchState } from "@/hooks/useResearchState";
import { AGENT_PIPELINE, type PipelineAgent } from "@/components/chat/types";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { CustomAgentNode } from "./CustomAgentNode";
import { CustomEdge } from "./CustomEdge";
import type { AgentNodeData, NodeStatus } from "./flow-types";
import type { AgentId, PipelinePhase } from "@/lib/agentcore-client/types";

const nodeTypes = { agentNode: CustomAgentNode };
const edgeTypes = { agentEdge: CustomEdge };

const DEFAULT_AGENT_TO_PHASE: Record<string, PipelinePhase> = {
    planner: "planning",
    researcher: "research",
    synthesizer: "synthesis & report",
    menu_designer: "design",
    menu_pdf_writer: "export",
};

const DEFAULT_DESCRIPTIONS: Record<string, string> = {
    user: "Research query",
    planner: "Decompose query",
    researcher: "Collect findings",
    synthesizer: "Synthesize & generate PDF",
    menu_designer: "Design menu",
    menu_pdf_writer: "Generate PDF",
};

export interface FlowConfig {
    pipeline: PipelineAgent[];
    agentToPhase?: Record<string, PipelinePhase>;
    descriptions?: Record<string, string>;
    userLabel?: string;
}

function AgentFlowInner({ mode, config }: { mode: string; config?: FlowConfig }) {
    const pipeline = config?.pipeline ?? AGENT_PIPELINE;
    const agentToPhase = config?.agentToPhase ?? DEFAULT_AGENT_TO_PHASE;
    const descriptions = config?.descriptions ?? DEFAULT_DESCRIPTIONS;
    const userLabel = config?.userLabel ?? "User";

    const state = useResearchState(mode);
    const [selectedNode, setSelectedNode] = useState<string | null>(null);

    const pipelineOrder: (AgentId | "user")[] = useMemo(
        () => ["user", ...pipeline.map((a) => a.id)],
        [pipeline]
    );

    const { nodes, edges } = useMemo(() => {
        function getNodeStatus(id: AgentId | "user"): NodeStatus {
            if (id === "user") {
                return state.isActive || state.completedPhases.length > 0 ? "completed" : "pending";
            }
            const phase = agentToPhase[id];
            if (phase && state.completedPhases.includes(phase)) return "completed";
            if (state.activeAgent === id) return "active";
            return "pending";
        }

        const traceCountByAgent: Record<string, number> = {};
        for (const trace of state.thinkingTraces) {
            traceCountByAgent[trace.agent] = (traceCountByAgent[trace.agent] ?? 0) + 1;
        }

        const builtNodes: Node<AgentNodeData>[] = pipelineOrder.map((id, i) => ({
            id,
            type: "agentNode",
            position: { x: 0, y: i * 100 },
            data: {
                agentId: id,
                label: id === "user" ? userLabel : (pipeline.find((a) => a.id === id)?.name ?? id),
                status: getNodeStatus(id),
                description: descriptions[id] ?? "",
                thinkingCount: traceCountByAgent[id] ?? 0,
            },
            draggable: false,
        }));

        const builtEdges: Edge[] = pipelineOrder.slice(0, -1).map((sourceId, i) => {
            const targetId = pipelineOrder[i + 1];
            const sourceStatus = getNodeStatus(sourceId);
            const targetStatus = getNodeStatus(targetId);

            let edgeStatus: "pending" | "active" | "completed" = "pending";
            if (sourceStatus === "completed" && targetStatus === "completed") {
                edgeStatus = "completed";
            } else if (
                sourceStatus === "completed" &&
                (targetStatus === "active" || targetStatus === "pending")
            ) {
                edgeStatus = "active";
            }

            return {
                id: `${sourceId}-${targetId}`,
                source: sourceId,
                target: targetId,
                type: "agentEdge",
                data: { status: edgeStatus },
            };
        });

        return { nodes: builtNodes, edges: builtEdges };
    }, [
        state.activeAgent,
        state.completedPhases,
        state.isActive,
        state.thinkingTraces,
        pipelineOrder,
        pipeline,
        agentToPhase,
        descriptions,
        userLabel,
    ]);

    const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        setSelectedNode((prev) => (prev === node.id ? null : node.id));
    }, []);

    const selectedTraces = selectedNode
        ? state.thinkingTraces.filter((t) => t.agent === selectedNode)
        : [];

    const selectedLabel = selectedNode
        ? (pipeline.find((a) => a.id === selectedNode)?.name ?? selectedNode)
        : "";

    const flowHeight = Math.max(300, pipelineOrder.length * 100 + 100);

    return (
        <div
            className="relative w-full rounded-lg border border-gray-200 bg-gray-50"
            style={{ height: flowHeight }}
        >
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodeClick={onNodeClick}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                panOnDrag={false}
                zoomOnScroll={false}
                zoomOnPinch={false}
                zoomOnDoubleClick={false}
                proOptions={{ hideAttribution: true }}
            >
                <Background />
                <Controls showInteractive={false} />
            </ReactFlow>

            {selectedNode && selectedNode !== "user" && (
                <div className="absolute right-0 top-0 h-full w-72 overflow-y-auto border-l border-gray-200 bg-white p-3 shadow-lg">
                    <div className="mb-2 flex items-center justify-between">
                        <Box variant="h4">{selectedLabel} Thinking</Box>
                        <button
                            onClick={() => setSelectedNode(null)}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        >
                            &times;
                        </button>
                    </div>
                    {selectedTraces.length > 0 ? (
                        <div className="space-y-2">
                            {selectedTraces.map((trace, i) => (
                                <div
                                    key={i}
                                    className="border-b border-gray-100 pb-2 last:border-0"
                                >
                                    <div className="mb-0.5 text-[10px] text-gray-400">
                                        {trace.timestamp.toLocaleTimeString()}
                                    </div>
                                    <div className="[&_.markdown-body]:text-xs [&_.markdown-body]:leading-snug">
                                        <MarkdownRenderer content={trace.content} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Box variant="p" color="text-body-secondary" fontSize="body-s">
                            No thinking traces yet.
                        </Box>
                    )}
                </div>
            )}
        </div>
    );
}

export function AgentFlowVisualization({ mode, config }: { mode: string; config?: FlowConfig }) {
    return (
        <ReactFlowProvider>
            <AgentFlowInner mode={mode} config={config} />
        </ReactFlowProvider>
    );
}
