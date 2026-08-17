import { useMemo, useState } from "react";
import ChatInterface from "@/components/chat/ChatInterface";
import { PipelineFlowSidebar } from "@/components/common/flow/PipelineFlowSidebar";
import { useResearchState } from "@/hooks/useResearchState";
import { SAMPLE_PROMPTS } from "@/config/samplePrompts";
import ResizablePanelLayout, {
    type ResizablePanelConfig,
} from "@/components/common/resizable/ResizablePanelLayout";

const MODE = "research";

export default function ResearchPage(): JSX.Element {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const research = useResearchState(MODE);
    const showSidebar = research.isActive || research.completedPhases.length > 0;

    // Main chat and pipeline panel share the width side by side, with a wide
    // pipeline panel so the flow diagram and run report read clearly. Minimal
    // constraints (3-5% floor, no maxSize) let the divider slide freely; the
    // collapse button covers "snap shut".
    const panels = useMemo(() => {
        const configs: ResizablePanelConfig[] = [
            { id: "research-main", defaultSize: 56, minSize: 5 },
        ];
        if (showSidebar) {
            configs.push({
                id: "research-sidebar",
                defaultSize: sidebarCollapsed ? 5 : 44,
                minSize: 3,
            });
        }
        const total = configs.reduce((s, c) => s + c.defaultSize, 0);
        return configs.map((c) => ({ ...c, defaultSize: (c.defaultSize / total) * 100 }));
    }, [showSidebar, sidebarCollapsed]);

    return (
        <ResizablePanelLayout
            autoSaveId="research-v3"
            direction="horizontal"
            panels={panels}
            className="h-full w-full"
        >
            <div className="h-full w-full min-w-0">
                <ChatInterface
                    title="Deep Research Agent"
                    samplePrompts={SAMPLE_PROMPTS.research}
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
