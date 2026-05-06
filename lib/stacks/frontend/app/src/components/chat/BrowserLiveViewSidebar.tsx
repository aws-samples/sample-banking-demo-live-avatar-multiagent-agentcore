import { useState } from "react";
import { motion } from "framer-motion";
import { useBrowserLiveViewStore } from "@/stores/browserLiveViewStore";

export function BrowserLiveViewSidebar(): JSX.Element | null {
    const liveViewUrl = useBrowserLiveViewStore((s) => s.liveViewUrl);
    const sessionId = useBrowserLiveViewStore((s) => s.sessionId);
    const screenshot = useBrowserLiveViewStore((s) => s.screenshot);
    const close = useBrowserLiveViewStore((s) => s.close);
    const [fullscreen, setFullscreen] = useState(false);

    if (!liveViewUrl) return null;

    return (
        <motion.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            className={
                fullscreen
                    ? "fixed inset-0 z-50 flex flex-col bg-slate-950"
                    : "flex h-full w-full min-w-0 flex-col border-l border-slate-800 bg-slate-950"
            }
            aria-label="AgentCore Browser live view"
        >
            <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                    <img src="/icons/agentcore/browser-tool.png" alt="" className="h-5 w-5" />
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-slate-100">AgentCore Browser</h2>
                        <p className="truncate text-[11px] text-slate-400">
                            Live view of the agent's browser session
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    {sessionId && (
                        <span className="mr-2 font-mono text-[10px] text-slate-500">
                            {sessionId.slice(0, 8)}
                        </span>
                    )}
                    <button
                        onClick={() => setFullscreen((v) => !v)}
                        className="rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
                        aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                    >
                        {fullscreen ? (
                            <svg
                                className="h-4 w-4"
                                viewBox="0 0 20 20"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5" />
                            </svg>
                        ) : (
                            <svg
                                className="h-4 w-4"
                                viewBox="0 0 20 20"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" />
                            </svg>
                        )}
                    </button>
                    <button
                        onClick={close}
                        className="rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
                        aria-label="Close live view"
                    >
                        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
                            <path
                                d="M5 5l10 10M15 5L5 15"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                            />
                        </svg>
                    </button>
                </div>
            </header>

            <div className="flex flex-1 items-center justify-center overflow-hidden bg-slate-900 p-3">
                {screenshot ? (
                    <img
                        src={`data:image/jpeg;base64,${screenshot}`}
                        alt="Browser screenshot"
                        className="w-full rounded shadow-lg"
                        style={{ aspectRatio: "1280 / 800" }}
                    />
                ) : (
                    <div className="flex flex-col items-center gap-3 text-slate-500">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-teal-400" />
                        <p className="text-sm">Waiting for browser activity...</p>
                    </div>
                )}
            </div>
        </motion.aside>
    );
}
