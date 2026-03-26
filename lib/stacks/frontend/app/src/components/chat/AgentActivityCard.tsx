import ProgressBar from "@cloudscape-design/components/progress-bar";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { AGENT_PIPELINE } from "./types";

interface AgentActivityCardProps {
    agent: string;
    phase: string;
    progress: number;
    activity: string;
    elapsed: number;
    done: boolean;
    tool?: string;
}

export function AgentActivityCard({
    agent,
    progress,
    activity,
    elapsed,
    done,
    tool,
}: AgentActivityCardProps): JSX.Element {
    const agentInfo = AGENT_PIPELINE.find((a) => a.id === agent);
    const color = agentInfo?.color ?? "#687078";
    const name = agentInfo?.name ?? agent;

    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    return (
        <div
            className="my-2 rounded-lg border border-gray-200 p-3 transition-opacity duration-500"
            style={{ opacity: done ? 0.6 : 1 }}
        >
            <div className="flex items-center gap-2 mb-2">
                <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${done ? "" : "animate-pulse"}`}
                    style={{ backgroundColor: color }}
                />
                <span className="font-medium text-sm" style={{ color }}>
                    {name}
                </span>
                <span className="text-xs text-gray-500 ml-auto">{timeStr}</span>
            </div>

            <ProgressBar value={progress} />

            <div className="flex items-center gap-2 mt-2">
                <StatusIndicator type={done ? "success" : "in-progress"}>
                    {activity}
                </StatusIndicator>
                {tool && !done && (
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">
                        {tool}
                    </span>
                )}
            </div>
        </div>
    );
}
