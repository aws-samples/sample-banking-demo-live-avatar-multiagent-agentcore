import { Wrench } from "lucide-react";
import type { ToolRenderProps } from "@/hooks/useToolRenderer";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import StatusIndicator from "@cloudscape-design/components/status-indicator";

export function ToolCallDisplay({ name, args, status, result }: ToolRenderProps): JSX.Element {
    const statusIndicator = (() => {
        switch (status) {
            case "streaming":
                return <StatusIndicator type="in-progress">Streaming</StatusIndicator>;
            case "executing":
                return <StatusIndicator type="in-progress">Executing</StatusIndicator>;
            case "complete":
                return <StatusIndicator type="success">Complete</StatusIndicator>;
            default:
                return null;
        }
    })();

    return (
        <div className="my-1 text-sm">
            <ExpandableSection
                variant="footer"
                headerText={
                    <span className="flex items-center gap-1.5">
                        <Wrench size={12} className="text-gray-400" />
                        <span className="text-gray-600">{name}</span>
                    </span>
                }
                headerActions={statusIndicator}
            >
                <div className="space-y-2">
                    {args && (
                        <div>
                            <div className="text-xs text-gray-400">Input</div>
                            <pre className="text-xs text-gray-600 whitespace-pre-wrap break-words mt-0.5">
                                {args}
                            </pre>
                        </div>
                    )}
                    {result && (
                        <div>
                            <div className="text-xs text-gray-400">Result</div>
                            <pre className="text-xs text-gray-600 whitespace-pre-wrap break-words mt-0.5">
                                {result}
                            </pre>
                        </div>
                    )}
                </div>
            </ExpandableSection>
        </div>
    );
}
