import { X } from "lucide-react";

/**
 * Embeds the generated services website, scrolled to the section the digital
 * human is currently discussing.
 *
 * The iframe is keyed by anchor by the parent, so switching category remounts
 * it and it loads at the new `#section` — a fragment change alone would not
 * re-scroll an already-loaded page.
 */
interface WebsiteShowcaseProps {
    /** Presigned website URL (already includes its query string). */
    url: string;
    /** Section anchor id to deep-link to. */
    anchor: string;
    /** Human-readable section name for the header. */
    label: string;
    /** Restore the full-size avatar. */
    onClose: () => void;
}

export default function WebsiteShowcase({
    url,
    anchor,
    label,
    onClose,
}: WebsiteShowcaseProps): JSX.Element {
    // Fragment goes after the presigned query string, which is correct.
    const src = anchor ? `${url}#${anchor}` : url;

    return (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-700 bg-white">
            <div className="flex flex-none items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {label || "Services"}
                    <span className="text-[11px] font-normal text-slate-500">
                        · from your generated site
                    </span>
                </span>
                <button
                    onClick={onClose}
                    aria-label="Close and restore the avatar"
                    className="rounded p-1 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
                >
                    <X size={18} />
                </button>
            </div>
            <iframe
                title={`${label || "Services"} — generated website`}
                src={src}
                className="min-h-0 flex-1 w-full border-0"
                // The site is our own generated content in S3; sandbox keeps it
                // from navigating the top window while still rendering scripts
                // (Tailwind CDN) and following in-page anchor links.
                sandbox="allow-scripts allow-same-origin allow-popups"
                loading="lazy"
            />
        </div>
    );
}
