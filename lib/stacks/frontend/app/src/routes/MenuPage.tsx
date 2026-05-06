import { useMemo, useState } from "react";
import ChatInterface from "@/components/chat/ChatInterface";
import { AgentFlowVisualization, type FlowConfig } from "@/components/flow/AgentFlowVisualization";
import {
    ResearchProgressBar,
    type ProgressBarConfig,
} from "@/components/research/ResearchProgressBar";
import { ThinkingContainer } from "@/components/research/ThinkingContainer";
import MenuWelcomeScreen from "@/components/menu/MenuWelcomeScreen";
import { useToolRenderer } from "@/hooks/useToolRenderer";
import { CanvasResultCard } from "@/components/chat/structured/CanvasResultCard";
import { MENU_PIPELINE } from "@/components/chat/types";
import { useResearchState } from "@/hooks/useResearchState";
import { useChatStore } from "@/stores/chatStore";
import type { PipelinePhase } from "@/lib/agentcore-client/types";
import Button from "@cloudscape-design/components/button";
import { PanelRight, PanelRightClose } from "lucide-react";
import ResizablePanelLayout, {
    type ResizablePanelConfig,
} from "@/components/common/resizable/ResizablePanelLayout";

const MODE = "menu";

const MENU_AGENT_TO_PHASE: Record<string, PipelinePhase> = {
    menu_designer: "design",
    menu_pdf_writer: "export",
};

const MENU_DESCRIPTIONS: Record<string, string> = {
    user: "Menu request",
    menu_designer: "Design menu",
    menu_pdf_writer: "Generate PDF",
};

const MENU_FLOW_CONFIG: FlowConfig = {
    pipeline: MENU_PIPELINE,
    agentToPhase: MENU_AGENT_TO_PHASE,
    descriptions: MENU_DESCRIPTIONS,
    userLabel: "User",
};

const MENU_PROGRESS_CONFIG: ProgressBarConfig = {
    phases: [
        { phase: "design", label: "Design", description: "Designing menu" },
        { phase: "export", label: "Export", description: "Generating PDF" },
    ],
    pipeline: MENU_PIPELINE,
    agentToPhase: MENU_AGENT_TO_PHASE,
};

function MenuPipelineSidebar({
    collapsed,
    onToggle,
}: {
    collapsed: boolean;
    onToggle: () => void;
}): JSX.Element {
    if (collapsed) {
        return (
            <div
                className="h-full w-full min-w-0 flex flex-col items-center py-3 glass-panel-strong"
                style={{ borderLeft: "1px solid var(--glass-border)" }}
            >
                <Button
                    variant="icon"
                    iconSvg={<PanelRight size={16} />}
                    onClick={onToggle}
                    ariaLabel="Expand sidebar"
                />
            </div>
        );
    }

    return (
        <div
            className="h-full w-full min-w-0 overflow-y-auto flex flex-col glass-panel-strong"
            style={{ borderLeft: "1px solid var(--glass-border)" }}
        >
            <div
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: "1px solid var(--glass-border)" }}
            >
                <span className="text-sm font-medium" style={{ color: "var(--app-text)" }}>
                    Menu Pipeline
                </span>
                <Button
                    variant="icon"
                    iconSvg={<PanelRightClose size={16} />}
                    onClick={onToggle}
                    ariaLabel="Collapse sidebar"
                />
            </div>

            <div className="flex flex-col gap-4 p-4">
                <ResearchProgressBar mode={MODE} config={MENU_PROGRESS_CONFIG} />
                <AgentFlowVisualization mode={MODE} config={MENU_FLOW_CONFIG} />
                <ThinkingContainer mode={MODE} pipeline={MENU_PIPELINE} />
            </div>
        </div>
    );
}

export default function MenuPage(): JSX.Element {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const research = useResearchState(MODE);
    const showSidebar = research.isActive || research.completedPhases.length > 0;

    // Panel configs: main chat takes most of the width; sidebar adds a panel
    // entry only when shown. Collapsed state just shrinks its defaultSize.
    // Constraints are intentionally loose so the user can drag the divider
    // across most of the viewport if they want to focus on either side.
    const menuPanels = useMemo(() => {
        const configs: ResizablePanelConfig[] = [{ id: "menu-main", defaultSize: 75, minSize: 10 }];
        if (showSidebar) {
            configs.push({
                id: "menu-sidebar",
                defaultSize: sidebarCollapsed ? 5 : 25,
                minSize: 3,
                maxSize: 70,
            });
        }
        const total = configs.reduce((s, c) => s + c.defaultSize, 0);
        return configs.map((c) => ({ ...c, defaultSize: (c.defaultSize / total) * 100 }));
    }, [showSidebar, sidebarCollapsed]);

    useToolRenderer("nova_canvas_generate", ({ result }) => (
        <CanvasResultCard
            result={result ?? "{}"}
            onAddToMenu={(imageUrl) => {
                useChatStore.getState().dispatchMenu({ type: "SET_LAST_ITEM_IMAGE", imageUrl });
            }}
        />
    ));

    return (
        <ResizablePanelLayout
            autoSaveId="menu-v2"
            direction="horizontal"
            panels={menuPanels}
            className="h-full"
        >
            <div className="h-full w-full min-w-0">
                <ChatInterface
                    mode="menu"
                    title="Menu Builder"
                    renderWelcome={(onExampleClick) => (
                        <MenuWelcomeScreen onExampleClick={onExampleClick} />
                    )}
                />
            </div>
            {showSidebar ? (
                <MenuPipelineSidebar
                    collapsed={sidebarCollapsed}
                    onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
                />
            ) : null}
        </ResizablePanelLayout>
    );
}
