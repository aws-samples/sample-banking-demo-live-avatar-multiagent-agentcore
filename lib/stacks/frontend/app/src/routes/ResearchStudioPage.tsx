import { useMemo, useState } from "react";
import ChatInterface from "@/components/chat/ChatInterface";
import { PipelineFlowSidebar } from "@/components/common/flow/PipelineFlowSidebar";
import { ResearchStudioWelcomeScreen } from "@/components/chat/ResearchStudioWelcomeScreen";
import { useResearchState } from "@/hooks/useResearchState";
import { SAMPLE_PROMPTS } from "@/config/samplePrompts";
import ResizablePanelLayout, {
    type ResizablePanelConfig,
} from "@/components/common/resizable/ResizablePanelLayout";

const MODE = "generic_research";

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
                <PipelineFlowSidebar
                    mode={MODE}
                    title="AgentCore Flow"
                    subtitle="Real-time view of the research pipeline & tool invocations"
                    collapsed={sidebarCollapsed}
                    onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
                />
            ) : null}
        </ResizablePanelLayout>
    );
}
