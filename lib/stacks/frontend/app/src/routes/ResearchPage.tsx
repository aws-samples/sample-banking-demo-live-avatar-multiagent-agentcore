import { useState } from "react";
import ChatInterface from "@/components/chat/ChatInterface";
import { AgentFlowVisualization } from "@/components/flow/AgentFlowVisualization";
import { ResearchProgressBar } from "@/components/research/ResearchProgressBar";
import { ThinkingContainer } from "@/components/research/ThinkingContainer";
import { useResearchState } from "@/hooks/useResearchState";
import Button from "@cloudscape-design/components/button";
import { PanelRight, PanelRightClose } from "lucide-react";

const MODE = "research";

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
                className="flex-none flex flex-col items-center py-3 glass-panel-strong"
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
            className="w-80 lg:w-96 flex-none overflow-y-auto flex flex-col glass-panel-strong"
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
                <ThinkingContainer mode={MODE} />
            </div>
        </div>
    );
}

export default function ResearchPage(): JSX.Element {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const research = useResearchState(MODE);
    const showSidebar = research.isActive || research.completedPhases.length > 0;

    return (
        <div className="flex h-full">
            <div className="flex-1 min-w-0">
                <ChatInterface title="Market Strategy" />
            </div>
            {showSidebar && (
                <ResearchSidebar
                    collapsed={sidebarCollapsed}
                    onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
                />
            )}
        </div>
    );
}
