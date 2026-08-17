import { useMemo, useState } from "react";
import ChatInterface from "@/components/chat/ChatInterface";
import { type FlowConfig } from "@/components/flow/AgentFlowVisualization";
import { type ProgressBarConfig } from "@/components/research/ResearchProgressBar";
import { PipelineFlowSidebar } from "@/components/common/flow/PipelineFlowSidebar";
import MenuWelcomeScreen from "@/components/menu/MenuWelcomeScreen";
import CatalogStudio from "@/components/menu/CatalogStudio";
import ContinuousFeedbackLoop from "@/components/menu/ContinuousFeedbackLoop";
import { useToolRenderer } from "@/hooks/useToolRenderer";
import { CanvasResultCard } from "@/components/chat/structured/CanvasResultCard";
import { MENU_PIPELINE } from "@/components/chat/types";
import { useResearchState } from "@/hooks/useResearchState";
import { useChatStore } from "@/stores/chatStore";
import type { PipelinePhase } from "@/lib/agentcore-client/types";
import ResizablePanelLayout, {
    type ResizablePanelConfig,
} from "@/components/common/resizable/ResizablePanelLayout";

const MODE = "menu";

const MENU_AGENT_TO_PHASE: Record<string, PipelinePhase> = {
    menu_designer: "design",
    menu_pdf_writer: "export",
};

const MENU_DESCRIPTIONS: Record<string, string> = {
    user: "Catalog request",
    menu_designer: "Design catalog",
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
        { phase: "design", label: "Design", description: "Designing catalog" },
        { phase: "export", label: "Export", description: "Generating PDF" },
    ],
    pipeline: MENU_PIPELINE,
    agentToPhase: MENU_AGENT_TO_PHASE,
};

export default function MenuPage(): JSX.Element {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const research = useResearchState(MODE);
    const showSidebar = research.isActive || research.completedPhases.length > 0;

    // Panel configs: main chat takes most of the width; sidebar adds a panel
    // entry only when shown. Collapsed state just shrinks its defaultSize.
    // Constraints are intentionally minimal — 3-5% floor, no maxSize — so the
    // divider can slide the full viewport width. The collapse button covers
    // the "snap shut" use case.
    const menuPanels = useMemo(() => {
        const configs: ResizablePanelConfig[] = [{ id: "menu-main", defaultSize: 56, minSize: 5 }];
        if (showSidebar) {
            configs.push({
                id: "menu-sidebar",
                defaultSize: sidebarCollapsed ? 5 : 44,
                minSize: 3,
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
            autoSaveId="menu-v3"
            direction="horizontal"
            panels={menuPanels}
            className="h-full w-full"
        >
            <div className="h-full w-full min-w-0">
                <ChatInterface
                    mode="menu"
                    title="AI Assistant"
                    renderWelcome={(onExampleClick) => (
                        <MenuWelcomeScreen onExampleClick={onExampleClick} />
                    )}
                />
            </div>
            {showSidebar ? (
                <PipelineFlowSidebar
                    mode={MODE}
                    title="AgentCore Flow"
                    subtitle="Real-time view of the catalog pipeline & tool invocations"
                    collapsed={sidebarCollapsed}
                    onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
                    flowConfig={MENU_FLOW_CONFIG}
                    progressConfig={MENU_PROGRESS_CONFIG}
                    extra={
                        <>
                            <CatalogStudio />
                            <ContinuousFeedbackLoop />
                        </>
                    }
                />
            ) : null}
        </ResizablePanelLayout>
    );
}
