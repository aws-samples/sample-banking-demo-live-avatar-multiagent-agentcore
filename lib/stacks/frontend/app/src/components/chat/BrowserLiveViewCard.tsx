import { BrowserLiveView } from "bedrock-agentcore/browser/live-view";

interface BrowserLiveViewCardProps {
    liveViewUrl: string;
    sessionId?: string;
    remoteWidth?: number;
    remoteHeight?: number;
}

export function BrowserLiveViewCard({
    liveViewUrl,
    sessionId,
    remoteWidth = 1280,
    remoteHeight = 800,
}: BrowserLiveViewCardProps): JSX.Element {
    return (
        <div className="my-2 rounded-lg border border-gray-200 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
                <img src="/icons/agentcore/browser-tool.png" alt="" className="w-4 h-4" />
                <span className="text-sm font-medium text-gray-700">
                    AgentCore Browser — Live View
                </span>
                {sessionId && (
                    <span className="ml-auto text-xs font-mono text-gray-400">
                        {sessionId.slice(0, 8)}
                    </span>
                )}
            </div>
            <div
                className="bg-slate-900"
                style={{ aspectRatio: `${remoteWidth} / ${remoteHeight}` }}
            >
                <BrowserLiveView
                    signedUrl={liveViewUrl}
                    remoteWidth={remoteWidth}
                    remoteHeight={remoteHeight}
                />
            </div>
        </div>
    );
}
