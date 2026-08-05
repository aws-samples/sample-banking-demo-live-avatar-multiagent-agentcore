/**
 * Turn a raw gateway tool result into the transcript segments the panel renders.
 *
 * Needed because Nova Sonic is speech-to-speech: when it uses a tool it speaks
 * the outcome ("I've generated that image for you") without ever emitting the
 * URL, so anything the tool produced is invisible unless the result itself is
 * read. The WebSocket transport got this for free — its backend attached
 * `mediaUrl`/`mediaType` to each tool message — but the LiveKit worker forwards
 * the tool output verbatim, so the parsing happens here instead.
 *
 * Field names come from the tool handlers in `gateway/tools/*`:
 *   nova_canvas_generate / nova_canvas_edit -> image_url
 *   nova_reel_status                        -> video_url
 *   website_generator / pdf_generator       -> url, or website_url on the
 *                                              pipeline path
 */

/** Segments this module can produce. Mirrors TranscriptSegment in AvatarInterface. */
export type ToolArtifact =
    | { kind: "media"; mediaType: "image" | "video"; url: string; toolName: string }
    | { kind: "kb"; resultJson: string }
    | { kind: "website"; url: string; title?: string; s3_key?: string };

interface ToolRecord {
    success?: boolean;
    image_url?: string;
    video_url?: string;
    url?: string;
    website_url?: string;
    title?: string;
    s3_key?: string;
    content?: Array<{ text?: string }>;
    [key: string]: unknown;
}

/** First `text` field of an MCP content-block list, if that is what this is. */
function unwrapContentBlocks(value: unknown): string | null {
    const blocks = Array.isArray(value) ? value : (value as ToolRecord | null)?.content;
    if (!Array.isArray(blocks)) return null;
    for (const block of blocks) {
        const text = (block as { text?: unknown } | null)?.text;
        if (typeof text === "string" && text) return text;
    }
    return null;
}

/**
 * Parse a tool result, unwrapping the MCP envelope when present.
 *
 * Gateway tools return their payload as a JSON string, but a tool routed
 * through MCP arrives wrapped in content blocks — either as
 * `{content: [{text: "<json>"}]}` or as a bare `[{text: "<json>"}]`, sometimes
 * nested twice. Both shapes are unwrapped by inspecting the value rather than
 * guessing from the tool name, since the same tool can arrive either way.
 */
function parseRecord(raw: string): ToolRecord | null {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return null;
    }

    // Three passes covers a bare block list holding an enveloped payload.
    for (let i = 0; i < 3; i++) {
        const nested = unwrapContentBlocks(value);
        if (nested === null) break;
        try {
            value = JSON.parse(nested);
        } catch {
            break;
        }
    }

    return value && !Array.isArray(value) && typeof value === "object"
        ? (value as ToolRecord)
        : null;
}

/**
 * Artifacts worth showing for a completed tool call.
 *
 * Returns an empty array when there is nothing to show, which is the common
 * case — most tools only inform the model and need no card of their own.
 */
export function extractToolArtifacts(toolName: string, rawOutput: string): ToolArtifact[] {
    if (!rawOutput) return [];

    // Knowledge-base results are handed to the card as-is: it renders the
    // result set itself, so parsing here would only risk disagreeing with it.
    if (toolName.includes("kb_search")) {
        return [{ kind: "kb", resultJson: rawOutput }];
    }

    const record = parseRecord(rawOutput);
    if (!record) return [];

    const artifacts: ToolArtifact[] = [];

    if (typeof record.image_url === "string" && record.image_url) {
        artifacts.push({
            kind: "media",
            mediaType: "image",
            url: record.image_url,
            toolName,
        });
    }

    if (typeof record.video_url === "string" && record.video_url) {
        artifacts.push({
            kind: "media",
            mediaType: "video",
            url: record.video_url,
            toolName,
        });
    }

    // `url` is generic, so it is only treated as a site or document when the
    // tool is one that produces one. Other tools use `url` for other things.
    // `website_url` is accepted too: website_generator returns `url` from the
    // avatar path but `website_url` from the pipeline path.
    const producesLink =
        toolName.includes("website_generator") || toolName.includes("pdf_generator");
    const link =
        typeof record.url === "string" && record.url
            ? record.url
            : typeof record.website_url === "string" && record.website_url
              ? record.website_url
              : "";
    if (producesLink && link) {
        artifacts.push({
            kind: "website",
            url: link,
            title: typeof record.title === "string" ? record.title : undefined,
            s3_key: typeof record.s3_key === "string" ? record.s3_key : undefined,
        });
    }

    return artifacts;
}
