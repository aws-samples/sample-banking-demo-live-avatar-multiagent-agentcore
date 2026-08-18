import { useEffect, useMemo, useState } from "react";
import {
    ReactFlow,
    Background,
    ReactFlowProvider,
    useReactFlow,
    type Node,
    type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ConciergeNode } from "./ConciergeNode";
import { ConciergeEdge } from "./ConciergeEdge";
import { NodeDetailModal } from "./NodeDetailModal";
import { useConciergeFlowStore } from "@/stores/conciergeFlowStore";
import type { ConciergeNodeData, NodeActivity } from "./flow-types";
import { TOOL_META, CONDITIONAL_REVEAL } from "./flow-types";

const nodeTypes = { conciergeNode: ConciergeNode };
const edgeTypes = { conciergeEdge: ConciergeEdge };

const ICON = (name: string) => `/icons/agentcore/${name}.png`;

// The cross-team A2A fraud-research hop only exists when the fraud runtime is
// deployed. The stack surfaces that as the string "true"/"false", so gate the
// flow-panel node/edge on the exact string (Requirement 9.1).
const FRAUD_AGENT_ENABLED = import.meta.env.VITE_FRAUD_AGENT_ENABLED === "true";

// The Bedrock Prompt Optimization showcase is feature-flagged off by default.
// The stack surfaces the flag as the string "true"/"false" (mirroring
// VITE_FRAUD_AGENT_ENABLED), so gate the node on the exact string so a "false"
// value never renders it (Requirement 9.1).
const PROMPT_OPT_ENABLED = import.meta.env.VITE_PROMPT_OPTIMIZATION_ENABLED === "true";

// A2A status (idle|active|completed|failed) maps 1:1 onto the node activity —
// `failed` is the terminal error state unique to this node (Req 9.3, 9.4).

// Static architecture layout (vertically stacked, tools fanned horizontally).
// y-rows: user=0, runtime=1, sidecars=2, gateway=3, tools=4, resources=5
const ROW_Y: Record<string, number> = {
    user: 0,
    runtime: 110,
    sidecar: 230,
    gateway: 350,
    tool: 490,
    resource: 650,
};
const CENTER_X = 420;

const TOOL_NAMES: string[] = [
    "kb_search",
    "web_search",
    "retrieve_user_profile",
    "open_account",
    "recall_memories",
    "image_generate",
    "extract_pdf_images",
    "website_generator",
    "pdf_generator",
    "data_sources",
];

function toolColumnX(i: number, total: number): number {
    const spacing = 215;
    const totalW = (total - 1) * spacing;
    return CENTER_X + i * spacing - totalW / 2;
}

interface BuildResult {
    nodes: Node<ConciergeNodeData>[];
    edges: Edge[];
}

function ConciergeFlowInner() {
    const runtimeActive = useConciergeFlowStore((s) => s.runtimeActive);
    const activeTool = useConciergeFlowStore((s) => s.activeTool);
    const invokedTools = useConciergeFlowStore((s) => s.invokedTools);
    const callCounts = useConciergeFlowStore((s) => s.callCounts);
    const anyActivity = useConciergeFlowStore((s) => s.events.length > 0);
    const a2a = useConciergeFlowStore((s) => s.a2a);
    const promptOpt = useConciergeFlowStore((s) => s.promptOpt);

    const { nodes, edges }: BuildResult = useMemo(() => {
        const ns: Node<ConciergeNodeData>[] = [];
        const es: Edge[] = [];

        const anyToolCalled = invokedTools.size > 0;

        // User
        ns.push({
            id: "user",
            type: "conciergeNode",
            position: { x: CENTER_X - 70, y: ROW_Y.user },
            data: {
                id: "user",
                label: "User",
                sublabel: "Client request",
                category: "user",
                activity: anyActivity ? "completed" : "idle",
            },
            draggable: false,
            selectable: false,
        });

        // Runtime (orchestrator)
        ns.push({
            id: "runtime",
            type: "conciergeNode",
            position: { x: CENTER_X - 110, y: ROW_Y.runtime },
            data: {
                id: "runtime",
                label: "AgentCore Runtime",
                sublabel: "Orchestrator",
                icon: ICON("runtime"),
                category: "core",
                activity: runtimeActive ? "active" : anyActivity ? "completed" : "idle",
            },
            draggable: false,
        });
        es.push({
            id: "user-runtime",
            source: "user",
            target: "runtime",
            type: "conciergeEdge",
            data: { status: runtimeActive || anyActivity ? "active" : "idle" },
        });

        // Cross-team A2A fraud-research hop — a distinct node to the right of the
        // runtime, rendered only when the fraud runtime is deployed. Its state is
        // driven straight from the store's `a2a` lifecycle (Requirement 9).
        if (FRAUD_AGENT_ENABLED) {
            ns.push({
                id: "fraud_research",
                type: "conciergeNode",
                position: { x: CENTER_X + 320, y: ROW_Y.sidecar },
                data: {
                    id: "fraud_research",
                    label: "Fraud Research Agent",
                    sublabel: "A2A · another team's agent",
                    icon: ICON("runtime"),
                    category: "a2a",
                    activity: a2a.status,
                    identityCarried: a2a.identityForwarded,
                },
                draggable: false,
            });
            es.push({
                id: "runtime-fraud_research",
                source: "runtime",
                target: "fraud_research",
                type: "conciergeEdge",
                data: { status: a2a.status, label: "A2A collaboration" },
            });
        }

        // Bedrock Prompt Optimization showcase — a distinct node to the right of
        // the runtime, rendered only when the feature flag is on. Its state is
        // driven straight from the store's `promptOpt` lifecycle: active while
        // OptimizePrompt requests stream, completed when a Variant is applied,
        // failed when every target fails (Requirement 9).
        if (PROMPT_OPT_ENABLED) {
            ns.push({
                id: "prompt_optimization",
                type: "conciergeNode",
                position: { x: CENTER_X + 260, y: ROW_Y.runtime },
                data: {
                    id: "prompt_optimization",
                    label: "Prompt Optimization",
                    sublabel: "Bedrock · OptimizePrompt",
                    icon: ICON("ai-agent"),
                    category: "prompt_opt",
                    activity: promptOpt.status,
                },
                draggable: false,
            });
            es.push({
                id: "runtime-prompt_optimization",
                source: "runtime",
                target: "prompt_optimization",
                type: "conciergeEdge",
                data: { status: promptOpt.status, label: "Optimize prompt" },
            });
        }

        // Sidecars: Guardrails (left) + Memory (right)
        const memoryActive = activeTool === "recall_memories";
        const memoryUsed = invokedTools.has("recall_memories");

        ns.push({
            id: "guardrails",
            type: "conciergeNode",
            position: { x: CENTER_X - 340, y: ROW_Y.sidecar },
            data: {
                id: "guardrails",
                label: "Guardrails",
                sublabel: "Content policies",
                icon: ICON("identity"),
                category: "core",
                activity: runtimeActive ? "active" : anyActivity ? "completed" : "idle",
            },
            draggable: false,
        });
        ns.push({
            id: "memory",
            type: "conciergeNode",
            position: { x: CENTER_X + 150, y: ROW_Y.sidecar },
            data: {
                id: "memory",
                label: "AgentCore Memory",
                sublabel: "Episodic + Semantic",
                icon: ICON("memory"),
                category: "core",
                activity: memoryActive ? "active" : memoryUsed ? "completed" : "idle",
                callCount: callCounts.recall_memories ?? 0,
            },
            draggable: false,
        });
        es.push({
            id: "runtime-guardrails",
            source: "runtime",
            target: "guardrails",
            type: "conciergeEdge",
            data: { status: runtimeActive ? "active" : anyActivity ? "completed" : "idle" },
        });
        es.push({
            id: "runtime-memory",
            source: "runtime",
            target: "memory",
            type: "conciergeEdge",
            data: { status: memoryActive ? "active" : memoryUsed ? "completed" : "idle" },
        });

        // Gateway
        const gatewayActive = !!activeTool && activeTool !== "recall_memories";

        // Tool count is derived from the nodes actually rendered below. It used
        // to be hardcoded ("16 tools") and had drifted out of step with both the
        // diagram and the tool catalogue, so the label contradicted the picture.
        const gatewayToolCount = TOOL_NAMES.filter((t) => t !== "recall_memories").length;

        ns.push({
            id: "gateway",
            type: "conciergeNode",
            position: { x: CENTER_X - 110, y: ROW_Y.gateway },
            data: {
                id: "gateway",
                label: "AgentCore Gateway",
                sublabel: `MCP · ${gatewayToolCount} tools`,
                icon: ICON("gateway"),
                category: "core",
                activity: gatewayActive ? "active" : anyToolCalled ? "completed" : "idle",
            },
            draggable: false,
        });
        es.push({
            id: "runtime-gateway",
            source: "runtime",
            target: "gateway",
            type: "conciergeEdge",
            data: { status: gatewayActive ? "active" : anyToolCalled ? "completed" : "idle" },
        });

        // Tools (excluding the memory tool — it connects to the memory sidecar)
        const gatewayTools = TOOL_NAMES.filter((t) => t !== "recall_memories");

        gatewayTools.forEach((toolName, i) => {
            const meta = TOOL_META[toolName] ?? { label: toolName };
            const invoked = invokedTools.has(toolName);
            const isActive = activeTool === toolName;
            const activity: NodeActivity = isActive ? "active" : invoked ? "completed" : "idle";
            const x = toolColumnX(i, gatewayTools.length);

            ns.push({
                id: toolName,
                type: "conciergeNode",
                position: { x: x - 100, y: ROW_Y.tool },
                data: {
                    id: toolName,
                    label: meta.label,
                    icon: meta.icon ?? ICON("ai-agent"),
                    category: "tool",
                    activity,
                    callCount: callCounts[toolName] ?? 0,
                },
                draggable: false,
            });
            es.push({
                id: `gateway-${toolName}`,
                source: "gateway",
                target: toolName,
                type: "conciergeEdge",
                data: { status: isActive ? "active" : invoked ? "completed" : "idle" },
            });
        });

        // Conditional resource nodes
        for (const [toolName, resourceId] of Object.entries(CONDITIONAL_REVEAL)) {
            if (!invokedTools.has(toolName)) continue;
            const isRunning = activeTool === toolName;
            const label = resourceId === "knowledge_base" ? "Knowledge Base" : "Code Interpreter";
            const sublabel = resourceId === "knowledge_base" ? "S3 Vectors" : "Sandboxed Python";
            const iconName = resourceId === "knowledge_base" ? "ai-agent" : "code-interpreter";
            // Position directly below the owning tool
            const toolNode = ns.find((n) => n.id === toolName);
            if (!toolNode) continue;

            ns.push({
                id: resourceId,
                type: "conciergeNode",
                position: { x: toolNode.position.x + 5, y: ROW_Y.resource },
                data: {
                    id: resourceId,
                    label,
                    sublabel,
                    icon: ICON(iconName),
                    category: "resource",
                    activity: isRunning ? "active" : "completed",
                },
                draggable: false,
            });
            es.push({
                id: `${toolName}-${resourceId}`,
                source: toolName,
                target: resourceId,
                type: "conciergeEdge",
                data: { status: isRunning ? "active" : "completed" },
            });
        }

        return { nodes: ns, edges: es };
    }, [runtimeActive, activeTool, invokedTools, callCounts, anyActivity, a2a, promptOpt]);

    // Auto-zoom: follow the current phase of execution.
    // Priority: activeTool > runtime (when no tool is running yet).
    const reactFlow = useReactFlow();
    useEffect(() => {
        const focusOnGroup = (ids: string[]) => {
            const group = nodes.filter((n) => ids.includes(n.id));
            if (group.length === 0) return;
            const xs = group.map((n) => n.position.x);
            const ys = group.map((n) => n.position.y);
            const minX = Math.min(...xs) - 40;
            const minY = Math.min(...ys) - 40;
            const maxX = Math.max(...xs) + 180 + 40;
            const maxY = Math.max(...ys) + 100 + 40;
            reactFlow.fitBounds(
                { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
                { padding: 0.2, duration: 700 }
            );
        };

        if (activeTool) {
            const isMemoryTool = activeTool === "recall_memories";
            const parentId = isMemoryTool ? "memory" : "gateway";
            // If this tool reveals a downstream resource, include it in focus.
            const downstream = CONDITIONAL_REVEAL[activeTool];
            const ids = [parentId, activeTool];
            if (downstream && nodes.some((n) => n.id === downstream)) ids.push(downstream);
            focusOnGroup(ids);
        } else if (runtimeActive) {
            // Runtime just started — focus on the orchestration core before tools fire.
            focusOnGroup(["user", "runtime", "guardrails", "memory"]);
        } else if (!anyActivity) {
            // Only fit-to-view on the initial idle state, before anything has
            // run. Once a run has happened we deliberately hold the last zoom
            // (wherever the final tool left the camera) rather than snapping
            // back out — the finished flow stays framed until the next run
            // starts or the page reloads.
            reactFlow.fitView({ padding: 0.15, duration: 500 });
        }
    }, [activeTool, runtimeActive, anyActivity, nodes, reactFlow]);

    const [selectedNode, setSelectedNode] = useState<string | null>(null);

    return (
        <div className="relative h-full w-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                fitViewOptions={{ padding: 0.15 }}
                nodesDraggable={false}
                nodesConnectable={false}
                panOnDrag={true}
                zoomOnScroll={true}
                zoomOnPinch={true}
                minZoom={0.3}
                maxZoom={1.5}
                onNodeClick={(_, node) => setSelectedNode(node.id)}
                proOptions={{ hideAttribution: true }}
            >
                <Background gap={18} size={1} color="#334155" />
            </ReactFlow>
            <NodeDetailModal nodeId={selectedNode} onClose={() => setSelectedNode(null)} />
        </div>
    );
}

export function ConciergeFlowDiagram() {
    return (
        <ReactFlowProvider>
            <ConciergeFlowInner />
        </ReactFlowProvider>
    );
}
