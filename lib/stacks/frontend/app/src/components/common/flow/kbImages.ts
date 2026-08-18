/**
 * A single Knowledge Base image returned by the multimodal `kb_search` tool.
 *
 * The gateway serialises its result as a JSON string carrying an `images`
 * array (empty when multimodal retrieval is off). Each entry pairs a
 * ready-to-use presigned HTTPS URL with the citation metadata the UI shows as
 * provenance. Owned here — next to {@link ./grounding} — so both chat windows
 * (AI Agent and avatar) share one tolerant parser with no store dependency.
 */
export interface KbImage {
    /** Ready-to-use presigned HTTPS URL (PNG/JPEG). */
    imageUrl: string;
    /** Source document filename, when the tool reported one. */
    source?: string;
    /** 1-based page the image was retrieved from, when known. */
    page?: number;
    /** Relevance score in [0, 1], when known. */
    score?: number;
    /** Citation id linking the image back to a text citation. */
    citationId?: number;
}

/**
 * Pull KB images out of a `kb_search` tool result string.
 *
 * Mirrors {@link ./grounding.extractGroundedSources}: tool names are
 * gateway-prefixed (e.g. `gateway_kb-search___kb_search`) so matching is by
 * substring, and any unexpected shape yields `[]` rather than throwing — this
 * runs on live, sometimes-partial tool output and must never break the stream
 * loop or a render. Results routed through MCP arrive wrapped in content
 * blocks (`{content:[{text:"<json>"}]}`), so the envelope is unwrapped before
 * reading `images`.
 *
 * Returns `[]` for non-KB tools, malformed payloads, or an empty/missing
 * `images` array, so callers can render unconditionally and simply no-op when
 * there is nothing to show.
 */
export function extractKbImages(toolName: string, rawResult: string | undefined): KbImage[] {
    if (!rawResult || !toolName) return [];
    const name = toolName.toLowerCase();
    if (!name.includes("kb_search") && !name.includes("kb-search")) return [];

    const record = parsePayload(rawResult);
    if (!record) return [];

    const images = Array.isArray(record.images) ? record.images : [];
    const out: KbImage[] = [];
    for (const raw of images) {
        if (!raw || typeof raw !== "object") continue;
        const img = raw as Record<string, unknown>;
        const url = typeof img.image_url === "string" ? img.image_url : "";
        // Only presigned HTTPS URLs are renderable; skip anything else defensively.
        if (!url.startsWith("http")) continue;
        out.push({
            imageUrl: url,
            source: typeof img.source === "string" ? img.source : undefined,
            page: Number.isFinite(img.page) ? (img.page as number) : undefined,
            score: typeof img.score === "number" ? img.score : undefined,
            citationId: Number.isFinite(img.citation_id) ? (img.citation_id as number) : undefined,
        });
    }
    return out;
}

/**
 * Accessible alt text for a KB image, naming the source document and page when
 * known so screen-reader users get the same provenance the caption shows.
 */
export function kbImageAltText({ source, page }: KbImage): string {
    const doc = source || "document";
    return page
        ? `Knowledge Base image from ${doc}, page ${page}`
        : `Knowledge Base image from ${doc}`;
}

/**
 * JSON.parse the result, unwrapping an MCP content-block envelope if present.
 * Defensive at every step: returns null on any malformed shape.
 */
function parsePayload(rawResult: string): Record<string, unknown> | null {
    let value: unknown;
    try {
        value = JSON.parse(rawResult);
    } catch {
        return null;
    }

    // MCP-routed tools wrap the payload as {content:[{text:"<json>"}]}, sometimes
    // nested. Two passes covers the shapes seen from the gateway.
    for (let i = 0; i < 2; i++) {
        const text = contentBlockText(value);
        if (text === null) break;
        try {
            value = JSON.parse(text);
        } catch {
            break;
        }
    }

    return value && !Array.isArray(value) && typeof value === "object"
        ? (value as Record<string, unknown>)
        : null;
}

/** First `text` field of an MCP content-block list, if that is what this is. */
function contentBlockText(value: unknown): string | null {
    const blocks = Array.isArray(value) ? value : (value as { content?: unknown } | null)?.content;
    if (!Array.isArray(blocks)) return null;
    for (const block of blocks) {
        const text = (block as { text?: unknown } | null)?.text;
        if (typeof text === "string" && text) return text;
    }
    return null;
}
