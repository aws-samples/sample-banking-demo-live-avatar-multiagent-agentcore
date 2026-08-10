import type { WebsiteWriterResult } from "./types";

/**
 * A link is safe to click only if it will actually resolve. The reports bucket
 * is private, so an S3 object URL works only when it carries a presigned
 * signature (`X-Amz-Signature`). Models sometimes relay a reconstructed,
 * unsigned S3 URL here, which 403s ("Access Denied") on click. When that
 * happens we suppress the dead button rather than hand the user a link that
 * fails — the runtime also emits a separate card built from the tool's real
 * presigned URL, so the working link is still shown.
 */
function isUsableLink(url: string): boolean {
    if (!url || !/^https?:\/\//i.test(url)) return false;
    const isS3 = /\.s3[.-][^/]*amazonaws\.com/i.test(url) || /\/\/s3[.-][^/]*amazonaws\.com/i.test(url);
    if (!isS3) return true; // external / non-S3 link — assume usable
    return url.includes("X-Amz-Signature") || url.includes("Signature=");
}

export function WebsiteWriterResultCard({ data }: { data: WebsiteWriterResult }): JSX.Element {
    // Either field name, depending on which phase produced it.
    const siteUrl = data.url ?? data.website_url ?? "";
    const sections = data.sections ?? data.sections_included ?? [];
    const viewUsable = isUsableLink(siteUrl);
    const downloadUsable = isUsableLink(data.download_url ?? "");
    return (
        <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-gray-900 to-gray-800 p-5 shadow-lg">
            <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">🌐</span>
                <h3 className="text-lg font-semibold text-white">
                    {data.title || "Banking Website"}
                </h3>
            </div>
            {sections.length > 0 && (
                <p className="text-sm text-gray-400 mb-4">
                    {sections.length} sections · {data.item_count ?? "—"} products
                </p>
            )}
            {viewUsable || downloadUsable ? (
                <div className="flex flex-wrap gap-3">
                    {viewUsable && (
                        <a
                            href={siteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold
                                       bg-gradient-to-r from-cyan-500 to-teal-400 text-gray-900
                                       hover:shadow-[0_0_20px_rgba(0,212,255,0.3)] transition-all duration-300"
                        >
                            View Website ↗
                        </a>
                    )}
                    {downloadUsable && (
                        <a
                            href={data.download_url}
                            // Same reason as the View link above: without a target
                            // this replaced the app and lost the conversation.
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold
                                       border border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/10 transition-all duration-300"
                        >
                            Download ↓
                        </a>
                    )}
                </div>
            ) : (
                <p className="text-sm text-gray-400">
                    Your website is ready — open it from the delivery card above.
                </p>
            )}
        </div>
    );
}
