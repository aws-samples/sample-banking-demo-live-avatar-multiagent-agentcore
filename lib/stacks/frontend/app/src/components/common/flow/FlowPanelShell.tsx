import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Maximize2, Minimize2, X } from "lucide-react";

/**
 * Shared chrome for every live agent-flow panel.
 *
 * The AI Agent's "AgentCore Flow" panel set the visual language — a dark framed
 * surface with a live/idle header, a diagram that fills the space, a Run Report
 * band, and a tool-activity feed beneath. This shell IS that structure,
 * extracted so the Deep Research Agent and AI Assistant panels are the same by
 * construction rather than by copy-paste that drifts.
 *
 * Layout, top to bottom:
 *   header  — live dot · title · Live/Idle · subtitle · (banner) · actions
 *   diagram — flex-1, fills the remaining height
 *   report  — fixed band (the Run Report)
 *   feed    — scrollable band (tool activity)
 */

interface FlowPanelShellProps {
    title: string;
    subtitle: string;
    /** Drives the header dot + Live/Idle label. */
    live: boolean;
    /** The flow diagram — fills the space between header and report. */
    diagram: ReactNode;
    /** The Run Report band. */
    report?: ReactNode;
    /** The activity feed band (shown when `hasFeed`). */
    feed?: ReactNode;
    /** When false, the feed area shows `feedEmpty` instead. */
    hasFeed?: boolean;
    feedEmpty?: ReactNode;
    /** Optional strip directly under the header (e.g. a phase progress bar). */
    banner?: ReactNode;
    /** Extra header action (e.g. the page's collapse button). */
    action?: ReactNode;
    /** When provided, renders a close (×) button in the header. */
    onClose?: () => void;
    /**
     * Optional experience-specific content rendered in a scrollable band below
     * the feed (e.g. the AI Assistant's catalog summary + feedback loop). When
     * present the whole panel scrolls and the diagram takes a fixed height
     * instead of filling, so the extra content is reachable.
     */
    extra?: ReactNode;
}

export function FlowPanelShell({
    title,
    subtitle,
    live,
    diagram,
    report,
    feed,
    hasFeed = false,
    feedEmpty,
    banner,
    action,
    onClose,
    extra,
}: FlowPanelShellProps): JSX.Element {
    const [fullscreen, setFullscreen] = useState(false);
    const scroll = !!extra;

    const base = fullscreen
        ? "fixed inset-0 z-50 flex flex-col bg-slate-950"
        : "flex h-full w-full min-w-0 flex-col border-l border-slate-800 bg-slate-950";

    return (
        <motion.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            className={scroll ? `${base} overflow-y-auto` : base}
            aria-label={`${title} diagram`}
        >
            <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span
                            className={`inline-block h-2 w-2 rounded-full ${
                                live ? "animate-pulse bg-amber-400" : "bg-slate-600"
                            }`}
                            aria-hidden
                        />
                        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
                        <span className="text-[10px] uppercase tracking-wider text-slate-500">
                            {live ? "Live" : "Idle"}
                        </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">{subtitle}</p>
                </div>
                <div className="flex items-center gap-1">
                    {action}
                    <button
                        onClick={() => setFullscreen((v) => !v)}
                        className="rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
                        aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                        title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                    >
                        {fullscreen ? (
                            <Minimize2 className="h-4 w-4" />
                        ) : (
                            <Maximize2 className="h-4 w-4" />
                        )}
                    </button>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
                            aria-label="Close flow diagram"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    )}
                </div>
            </header>

            {banner && (
                <div className="flex-none border-b border-slate-800 px-4 py-2">{banner}</div>
            )}

            <div
                className={
                    scroll
                        ? "relative h-[380px] flex-none border-b border-slate-800"
                        : "relative flex-1 border-b border-slate-800"
                }
            >
                {diagram}
            </div>

            {report && <div className="flex-none">{report}</div>}

            <div
                className={
                    scroll
                        ? "min-h-[110px] flex-none overflow-y-auto"
                        : "h-[30%] min-h-[110px] flex-none overflow-y-auto"
                }
            >
                {hasFeed ? feed : feedEmpty}
            </div>

            {extra && (
                <div className="flex flex-none flex-col gap-4 border-t border-slate-800 p-3">
                    {extra}
                </div>
            )}
        </motion.aside>
    );
}
