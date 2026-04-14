import type { WebsiteWriterResult } from "./types";

export function WebsiteWriterResultCard({ data }: { data: WebsiteWriterResult }): JSX.Element {
    return (
        <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-gray-900 to-gray-800 p-5 shadow-lg">
            <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">🌐</span>
                <h3 className="text-lg font-semibold text-white">
                    {data.title || "Restaurant Website"}
                </h3>
            </div>
            {data.sections && data.sections.length > 0 && (
                <p className="text-sm text-gray-400 mb-4">
                    {data.sections.length} sections · {data.item_count ?? "—"} dishes
                </p>
            )}
            <a
                href={data.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold
                           bg-gradient-to-r from-cyan-500 to-teal-400 text-gray-900
                           hover:shadow-[0_0_20px_rgba(0,212,255,0.3)] transition-all duration-300"
            >
                View Website ↗
            </a>
        </div>
    );
}
