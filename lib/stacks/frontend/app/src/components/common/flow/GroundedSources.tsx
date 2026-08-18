import { FileText, Globe, Link2 } from "lucide-react";
import { useConciergeFlowStore } from "@/stores/conciergeFlowStore";

/**
 * The concrete resources the run grounded its answer in.
 *
 * Turns the Run Report's abstract "2 KB · 1 web" counts into the actual
 * documents (with pages) and web domains that were pulled, each linking to its
 * source — the visible evidence trail behind a grounded answer. Populated live
 * from grounding tool results captured into the flow store.
 */
export function GroundedSources(): JSX.Element | null {
    const sources = useConciergeFlowStore((s) => s.sources);
    if (sources.length === 0) return null;

    const kbCount = sources.filter((s) => s.kind === "kb").length;
    const webCount = sources.length - kbCount;

    return (
        <section className="border-t border-slate-800 px-4 py-3" aria-label="Grounded sources">
            <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
                    <Link2 size={13} /> Grounded in
                </span>
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                    {kbCount} KB · {webCount} web
                </span>
            </div>
            <ul className="flex flex-col gap-1">
                {sources.map((src, i) => {
                    const Icon = src.kind === "kb" ? FileText : Globe;
                    const iconColor = src.kind === "kb" ? "text-sky-400" : "text-emerald-400";
                    const row = (
                        <span className="flex min-w-0 items-center gap-2">
                            <Icon size={12} className={`shrink-0 ${iconColor}`} />
                            <span className="min-w-0 truncate text-[11px] text-slate-200" title={src.title}>
                                {src.title}
                            </span>
                            {src.detail ? (
                                <span className="shrink-0 text-[10px] text-slate-500">{src.detail}</span>
                            ) : null}
                        </span>
                    );
                    return (
                        <li
                            key={`${src.kind}-${src.title}-${i}`}
                            className="rounded-md border border-slate-800 bg-slate-900/40 px-2 py-1.5"
                        >
                            {src.url ? (
                                <a
                                    href={src.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block transition-colors hover:text-white"
                                >
                                    {row}
                                </a>
                            ) : (
                                row
                            )}
                        </li>
                    );
                })}
            </ul>
            <p className="mt-2 text-[10px] leading-snug text-slate-500">
                Sources pulled by the knowledge base and web-grounding tools this run.
            </p>
        </section>
    );
}
