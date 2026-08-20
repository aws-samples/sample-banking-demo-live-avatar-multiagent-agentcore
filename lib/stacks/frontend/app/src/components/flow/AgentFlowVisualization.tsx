import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
    ReactFlow,
    Background,
    Controls,
    ReactFlowProvider,
    useReactFlow,
    type Node,
    type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useResearchState } from "@/hooks/useResearchState";
import { AGENT_PIPELINE, type PipelineAgent } from "@/components/chat/types";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { CustomAgentNode } from "./CustomAgentNode";
import { CustomEdge } from "./CustomEdge";
import type { AgentNodeData, NodeStatus } from "./flow-types";
import { AGENT_COLORS, AGENT_ICONS } from "./flow-types";
import type { AgentId, PipelinePhase } from "@/lib/agentcore-client/types";
import { ServicePlaneLegend, ToolServiceList } from "@/components/common/ServiceChips";

const nodeTypes = { agentNode: CustomAgentNode };
const edgeTypes = { agentEdge: CustomEdge };

const DEFAULT_AGENT_TO_PHASE: Record<string, PipelinePhase> = {
    planner: "planning",
    researcher: "research",
    synthesizer: "synthesis & report",
    evaluator: "evaluation",
    menu_designer: "design",
    menu_pdf_writer: "export",
};

const DEFAULT_DESCRIPTIONS: Record<string, string> = {
    user: "Research brief",
    planner: "Decompose the brief",
    researcher: "Gather evidence",
    synthesizer: "Synthesize & generate PDF",
    evaluator: "Score against brief & evidence",
    menu_designer: "Design catalog",
    menu_pdf_writer: "Generate PDF",
};

export interface FlowConfig {
    pipeline: PipelineAgent[];
    agentToPhase?: Record<string, PipelinePhase>;
    descriptions?: Record<string, string>;
    userLabel?: string;
}

function AgentFlowInner({
    mode,
    config,
    fill = false,
}: {
    mode: string;
    config?: FlowConfig;
    fill?: boolean;
}) {
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
            position: { x: 0, y: i * 132 },
            data: {
                agentId: id,
                label: id === "user" ? userLabel : (pipeline.find((a) => a.id === id)?.name ?? id),
                status: getNodeStatus(id),
                description: descriptions[id] ?? "",
                thinkingCount: traceCountByAgent[id] ?? 0,
                toolCounts: state.toolsByAgent[id] ?? {},
                // Stagger the entrance animation down the pipeline so the graph
                // assembles top-to-bottom instead of popping in all at once.
                orderIndex: i,
                // Clicking a service chip opens the same side panel as clicking
                // the node, so there is one place to read a step's detail.
                onInspect: () => setSelectedNode(id),
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
                // The active edge takes the downstream stage's accent so the
                // travelling pulse visibly carries that stage's identity.
                data: {
                    status: edgeStatus,
                    accent: AGENT_COLORS[targetId as AgentId] ?? "#4a9eff",
                },
            };
        });

        return { nodes: builtNodes, edges: builtEdges };
    }, [
        state.activeAgent,
        state.completedPhases,
        state.isActive,
        state.thinkingTraces,
        state.toolsByAgent,
        pipelineOrder,
        pipeline,
        agentToPhase,
        descriptions,
        userLabel,
    ]);

    const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        setSelectedNode((prev) => (prev === node.id ? null : node.id));
    }, []);

    // Keep the workflow centered when the panel layout shifts. `fitView` runs
    // once on mount, so when a run starts — the progress banner, run report and
    // activity feed appear and the flex-1 diagram container resizes — the graph
    // was left pinned off-center until the user hit the recenter control. Re-fit
    // on container resize and when the run begins/ends.
    const { fitView } = useReactFlow();
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const refitFrameRef = useRef<number | null>(null);

    const refit = useCallback(() => {
        if (refitFrameRef.current != null) cancelAnimationFrame(refitFrameRef.current);
        // Defer to the next frame so React Flow measures the settled container.
        refitFrameRef.current = requestAnimationFrame(() => {
            refitFrameRef.current = null;
            void fitView({ padding: 0.18, duration: 200 });
        });
    }, [fitView]);

    useEffect(() => {
        const el = wrapperRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(() => refit());
        observer.observe(el);
        return () => {
            observer.disconnect();
            if (refitFrameRef.current != null) cancelAnimationFrame(refitFrameRef.current);
        };
    }, [refit]);

    useEffect(() => {
        refit();
    }, [refit, state.isActive, nodes.length, edges.length]);

    const selectedTraces = selectedNode
        ? state.thinkingTraces.filter((t) => t.agent === selectedNode)
        : [];

    const selectedLabel = selectedNode
        ? (pipeline.find((a) => a.id === selectedNode)?.name ?? selectedNode)
        : "";

    const selectedToolCounts = selectedNode ? (state.toolsByAgent[selectedNode] ?? {}) : {};

    // Structured metadata for the enlarged step inspector.
    const selectedPhase = selectedNode ? agentToPhase[selectedNode] : undefined;
    const selectedStatus: NodeStatus =
        selectedPhase && state.completedPhases.includes(selectedPhase)
            ? "completed"
            : state.activeAgent === selectedNode
              ? "active"
              : "pending";
    const selectedDescription = selectedNode ? (descriptions[selectedNode] ?? "") : "";
    const selectedIcon = selectedNode ? AGENT_ICONS[selectedNode as AgentId | "user"] : undefined;
    const selectedAccent = selectedNode
        ? (AGENT_COLORS[selectedNode as AgentId] ?? "#94a3b8")
        : "#94a3b8";
    const selectedToolTotal = Object.values(selectedToolCounts).reduce((a, b) => a + b, 0);

    const statusMeta: Record<NodeStatus, { label: string; color: string }> = {
        active: { label: "Active", color: "#4a9eff" },
        completed: { label: "Complete", color: "#4fd1a5" },
        pending: { label: "Pending", color: "#94a3b8" },
    };

    const inspectorOpen = !!selectedNode && selectedNode !== "user";

    // Escape closes the enlarged inspector. Listener is registered from the
    // effect and calls setState from its callback (not synchronously).
    useEffect(() => {
        if (!inspectorOpen) return;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") setSelectedNode(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [inspectorOpen]);

    // Tall enough for large, legible nodes but capped so `fitView` shows the
    // whole workflow at once instead of overflowing the panel — the run report
    // and other rail content sit just below it in the scroll.
    const flowHeight = Math.min(Math.max(420, pipelineOrder.length * 120 + 90), 560);

    return (
        <div
            className={
                fill
                    ? "relative flex h-full w-full flex-col overflow-hidden"
                    : "relative w-full overflow-hidden rounded-xl border"
            }
            style={{
                borderColor: fill ? undefined : "rgba(71,85,105,0.4)",
                background:
                    "linear-gradient(160deg, rgb(15,23,42) 0%, rgb(11,17,32) 55%, rgb(15,23,42) 100%)",
            }}
        >
            {/* Header: run state, status key, and the affordance that makes the
                step inspector discoverable — without it the enlarged popout is
                hidden behind an undiscoverable click. In fill mode the parent
                shell already carries the run-state header, so we drop the left
                cluster and keep just the status key. */}
            <div className="flex flex-none items-center justify-between gap-3 border-b border-slate-800 px-3 py-2">
                {fill ? (
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">
                        Agent Workflow
                    </span>
                ) : (
                    <div className="flex items-center gap-2">
                        <span
                            className={`inline-block h-2 w-2 rounded-full ${
                                state.isActive ? "animate-pulse bg-emerald-400" : "bg-slate-600"
                            }`}
                            aria-hidden
                        />
                        <span className="text-xs font-semibold text-slate-100">Agent Workflow</span>
                        <span className="text-[10px] uppercase tracking-wider text-slate-500">
                            {state.isActive ? "Live" : "Idle"}
                        </span>
                    </div>
                )}
                <div className="flex items-center gap-2.5">
                    {(
                        [
                            ["active", "Active"],
                            ["completed", "Done"],
                            ["pending", "Pending"],
                        ] as const
                    ).map(([key, label]) => (
                        <span
                            key={key}
                            className="inline-flex items-center gap-1 text-[9.5px] text-slate-400"
                        >
                            <span
                                aria-hidden
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ background: statusMeta[key].color }}
                            />
                            {label}
                        </span>
                    ))}
                </div>
            </div>

            <div
                ref={wrapperRef}
                className={fill ? "relative w-full flex-1" : "relative w-full"}
                style={fill ? undefined : { height: flowHeight }}
            >
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    onNodeClick={onNodeClick}
                    fitView
                    fitViewOptions={{ padding: 0.18 }}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    // Press-and-hold drag to pan the workflow around the grid
                    // (up/down/left/right). Panning is independent of the wheel,
                    // so it does not re-break the scroll bubbling below.
                    panOnDrag={true}
                    // Wheel zoom stays OFF so wheel events bubble to the
                    // sidebar's scroll container — ReactFlow otherwise captures
                    // the wheel over the pane, which trapped scrolling on the
                    // diagram and left the panel content below it (lower nodes,
                    // the run report) unreachable. Zoom is available via the
                    // on-canvas +/- Controls instead.
                    zoomOnScroll={false}
                    zoomOnPinch={false}
                    zoomOnDoubleClick={false}
                    preventScrolling={false}
                    proOptions={{ hideAttribution: true }}
                >
                    <Background gap={20} size={1} color="#1e293b" />
                    <Controls showInteractive={false} />
                </ReactFlow>

                {/* Discoverability hint for the step inspector. */}
                <div className="pointer-events-none absolute bottom-2 right-2 rounded-full border border-slate-700/70 bg-slate-950/70 px-2.5 py-1 text-[9.5px] text-slate-400 backdrop-blur-sm">
                    Click a step for details
                </div>
            </div>

            {inspectorOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`${selectedLabel} step detail`}
                >
                    <div
                        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
                        onClick={() => setSelectedNode(null)}
                        aria-hidden
                    />
                    <div className="relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
                        {/* Header: identity + live status */}
                        <div
                            className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4"
                            style={{
                                background: `linear-gradient(135deg, ${selectedAccent}1f, transparent)`,
                            }}
                        >
                            <div className="flex items-center gap-3">
                                <div
                                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                                    style={{
                                        background: `${selectedAccent}1f`,
                                        border: `1px solid ${selectedAccent}55`,
                                    }}
                                >
                                    {selectedIcon ? (
                                        <img
                                            src={selectedIcon}
                                            alt=""
                                            className="h-6 w-6 object-contain"
                                        />
                                    ) : null}
                                </div>
                                <div>
                                    <div className="text-lg font-semibold text-slate-100">
                                        {selectedLabel}
                                    </div>
                                    {selectedDescription && (
                                        <div className="text-xs text-slate-400">
                                            {selectedDescription}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span
                                    className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
                                    style={{
                                        color: statusMeta[selectedStatus].color,
                                        background: `${statusMeta[selectedStatus].color}1a`,
                                        border: `1px solid ${statusMeta[selectedStatus].color}55`,
                                    }}
                                >
                                    <span
                                        className="h-1.5 w-1.5 rounded-full"
                                        style={{ background: statusMeta[selectedStatus].color }}
                                    />
                                    {statusMeta[selectedStatus].label}
                                </span>
                                <button
                                    onClick={() => setSelectedNode(null)}
                                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                                    aria-label="Close step detail"
                                >
                                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
                                        <path
                                            d="M5 5l10 10M15 5L5 15"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                        />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                            {/* Structured metadata */}
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {[
                                    { label: "Phase", value: selectedPhase ?? "—" },
                                    { label: "Status", value: statusMeta[selectedStatus].label },
                                    { label: "Tool calls", value: String(selectedToolTotal) },
                                    {
                                        label: "Activity steps",
                                        value: String(selectedTraces.length),
                                    },
                                ].map((m) => (
                                    <div
                                        key={m.label}
                                        className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
                                    >
                                        <div className="text-[10px] uppercase tracking-wide text-slate-500">
                                            {m.label}
                                        </div>
                                        <div className="mt-0.5 truncate text-sm font-semibold capitalize text-slate-100">
                                            {m.value}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Tools & AWS services this step exercised */}
                            <section>
                                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                    Tools &amp; AWS Services
                                </div>
                                <ToolServiceList toolCounts={selectedToolCounts} />
                                <div className="mt-3 border-t border-slate-800 pt-2">
                                    <ServicePlaneLegend />
                                </div>
                            </section>

                            {/* Activity & output — the streamed reasoning/output
                                for this step, now the primary reading surface. */}
                            <section>
                                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                    Activity &amp; Output
                                </div>
                                {selectedTraces.length > 0 ? (
                                    <div className="space-y-3">
                                        {selectedTraces.map((trace, i) => (
                                            <div
                                                key={i}
                                                className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"
                                            >
                                                <div className="mb-1 text-[10px] text-slate-500">
                                                    {trace.timestamp.toLocaleTimeString()}
                                                </div>
                                                <div className="text-slate-200 [&_.markdown-body]:text-sm [&_.markdown-body]:leading-relaxed">
                                                    <MarkdownRenderer content={trace.content} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-slate-400">
                                        No activity captured for this step yet. It will populate as
                                        the step runs.
                                    </p>
                                )}
                            </section>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export function AgentFlowVisualization({
    mode,
    config,
    fill,
}: {
    mode: string;
    config?: FlowConfig;
    fill?: boolean;
}) {
    return (
        <ReactFlowProvider>
            <AgentFlowInner mode={mode} config={config} fill={fill} />
        </ReactFlowProvider>
    );
}
