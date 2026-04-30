import { useConciergeFlowStore } from "@/stores/conciergeFlowStore";
import { TOOL_META } from "./flow-types";

function fmtElapsed(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

export function ToolActivityTimeline() {
    const events = useConciergeFlowStore((s) => s.events);

    return (
        <ol className="space-y-1 p-3">
            {events
                .slice()
                .reverse()
                .map((e) => {
                    const label = TOOL_META[e.name]?.label ?? e.name;
                    const isRunning = e.status === "running";
                    const elapsed =
                        e.completedAt && e.startedAt
                            ? fmtElapsed(e.completedAt - e.startedAt)
                            : null;

                    return (
                        <li
                            key={e.toolUseId}
                            className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900/40 px-2.5 py-1.5"
                        >
                            <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                    isRunning ? "animate-pulse bg-amber-400" : "bg-emerald-400"
                                }`}
                                aria-hidden
                            />
                            <span className="flex-1 truncate text-[11px] font-medium text-slate-200">
                                {label}
                            </span>
                            <span className="text-[10px] text-slate-500">
                                {isRunning ? "running…" : (elapsed ?? "done")}
                            </span>
                        </li>
                    );
                })}
        </ol>
    );
}
