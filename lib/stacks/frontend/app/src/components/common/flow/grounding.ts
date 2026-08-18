/**
 * A concrete source the run actually pulled from, parsed out of a grounding
 * tool's result (kb_search / web_search). Turns the Run Report's "2 KB · 1 web"
 * counts into visible provenance — the specific documents and domains the
 * answer was grounded in. Owned here (rather than the store) so the pure parser
 * has no store dependency and stays unit-testable in isolation.
 */
export interface GroundedSource {
    kind: "kb" | "web";
    /** Document filename (KB) or domain / page title (web). */
    title: string;
    /** Secondary line, e.g. "p.2 · 0.71" for KB or the full domain for web. */
    detail?: string;
    /** Resolvable link when the tool returned one. */
    url?: string;
}

/**
 * Pull concrete grounded sources out of a grounding tool's result string.
 *
 * The runtime streams kb_search / web_search results as JSON strings; the
 * citation metadata (document filenames, pages, scores, web domains) lives only
 * in that transient payload. This parses it into a stable {@link GroundedSource}
 * list the flow panel can aggregate, so "2 KB lookups" becomes the actual
 * documents and domains the answer was grounded in.
 *
 * Defensive by design: it runs on live, sometimes-partial tool output, so any
 * unexpected shape yields [] rather than throwing and breaking the stream loop.
 */
export function extractGroundedSources(toolName: string, rawResult: string): GroundedSource[] {
    if (!rawResult) return [];
    const name = toolName.toLowerCase();
    const isKb = name.includes("kb_search") || name.includes("kb-search");
    const isWeb = name.includes("web_search") || name.includes("web-search");
    if (!isKb && !isWeb) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawResult);
    } catch {
        return [];
    }
    if (!parsed || typeof parsed !== "object") return [];
    const record = parsed as Record<string, unknown>;

    return isKb ? kbSources(record) : webSources(record);
}

function kbSources(record: Record<string, unknown>): GroundedSource[] {
    const out: GroundedSource[] = [];

    // Prefer `documents` — one entry per source file with the pages referenced.
    const documents = Array.isArray(record.documents) ? record.documents : [];
    for (const doc of documents) {
        if (!doc || typeof doc !== "object") continue;
        const d = doc as Record<string, unknown>;
        const title = typeof d.filename === "string" ? d.filename : "";
        if (!title) continue;
        const pages = Array.isArray(d.pages_referenced) ? d.pages_referenced.filter(Number.isFinite) : [];
        out.push({
            kind: "kb",
            title,
            detail: pages.length ? `p.${pages.join(", ")}` : undefined,
            url: typeof d.url === "string" ? d.url : undefined,
        });
    }
    if (out.length) return out;

    // Fallback: derive from `citations` when no document rollup is present.
    const citations = Array.isArray(record.citations) ? record.citations : [];
    for (const cite of citations) {
        if (!cite || typeof cite !== "object") continue;
        const c = cite as Record<string, unknown>;
        const title = typeof c.source === "string" ? c.source : "";
        if (!title) continue;
        const bits: string[] = [];
        if (Number.isFinite(c.page)) bits.push(`p.${c.page}`);
        if (typeof c.score === "number") bits.push(c.score.toFixed(2));
        out.push({
            kind: "kb",
            title,
            detail: bits.length ? bits.join(" · ") : undefined,
            url: typeof c.url === "string" ? c.url : undefined,
        });
    }
    return out;
}

function webSources(record: Record<string, unknown>): GroundedSource[] {
    const out: GroundedSource[] = [];
    // web_search returns citations as [{url, domain}]; some shapes use `sources`.
    const list = Array.isArray(record.citations)
        ? record.citations
        : Array.isArray(record.sources)
          ? record.sources
          : [];
    for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const c = item as Record<string, unknown>;
        const url = typeof c.url === "string" ? c.url : undefined;
        const domain =
            typeof c.domain === "string" && c.domain
                ? c.domain
                : url
                  ? hostnameOf(url)
                  : "";
        if (!domain && !url) continue;
        out.push({ kind: "web", title: domain || url || "web source", detail: undefined, url });
    }
    return out;
}

function hostnameOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return "";
    }
}
