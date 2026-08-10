import { useMemo, useState } from "react";
import ChatInterface from "@/components/chat/ChatInterface";
import { AgentFlowVisualization } from "@/components/flow/AgentFlowVisualization";
import { ResearchProgressBar } from "@/components/research/ResearchProgressBar";
import PipelineRunReport from "@/components/research/PipelineRunReport";
import { ResearchStudioWelcomeScreen } from "@/components/chat/ResearchStudioWelcomeScreen";
import { useResearchState } from "@/hooks/useResearchState";
import { SAMPLE_PROMPTS } from "@/config/samplePrompts";
import Button from "@cloudscape-design/components/button";
import { PanelRight, PanelRightClose } from "lucide-react";
import ResizablePanelLayout, {
    type ResizablePanelConfig,
} from "@/components/common/resizable/ResizablePanelLayout";

const MODE = "generic_research";

function ResearchSidebar({
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
                    Research Pipeline
                </span>
                <Button
                    variant="icon"
                    iconSvg={<PanelRightClose size={16} />}
                    onClick={onToggle}
                    ariaLabel="Collapse sidebar"
                />
            </div>

            <div className="flex flex-col gap-4 p-4">
                <ResearchProgressBar mode={MODE} />
                <AgentFlowVisualization mode={MODE} />
                <PipelineRunReport mode={MODE} />
            </div>
        </div>
    );
}

export default function ResearchStudioPage(): JSX.Element {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const research = useResearchState(MODE);
    const showSidebar = research.isActive || research.completedPhases.length > 0;

    const panels = useMemo(() => {
        const configs: ResizablePanelConfig[] = [
            { id: "studio-main", defaultSize: 56, minSize: 5 },
        ];
        if (showSidebar) {
            configs.push({
                id: "studio-sidebar",
                defaultSize: sidebarCollapsed ? 5 : 44,
                minSize: 3,
            });
        }
        const total = configs.reduce((s, c) => s + c.defaultSize, 0);
        return configs.map((c) => ({ ...c, defaultSize: (c.defaultSize / total) * 100 }));
    }, [showSidebar, sidebarCollapsed]);

    return (
        <ResizablePanelLayout
            autoSaveId="studio-v3"
            direction="horizontal"
            panels={panels}
            className="h-full w-full"
        >
            <div className="h-full w-full min-w-0">
                <ChatInterface
                    mode="generic_research"
                    title="Research Studio"
                    samplePrompts={SAMPLE_PROMPTS.generic_research}
                    renderWelcome={(onExampleClick) => (
                        <ResearchStudioWelcomeScreen onExampleClick={onExampleClick} />
                    )}
                />
            </div>
            {showSidebar ? (
                <ResearchSidebar
                    collapsed={sidebarCollapsed}
                    onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
                />
            ) : null}
        </ResizablePanelLayout>
    );
}
