import type { ContentPart, StructuredType } from "./types";

/** Identify which agent schema a parsed JSON object matches */
export function identifySchema(data: unknown): StructuredType | null {
    if (!data || typeof data !== "object") return null;
    const obj = data as Record<string, unknown>;

    if ("research_topic" in obj && "sub_questions" in obj) return "planner";
    if ("question" in obj && ("kb_findings" in obj || "web_findings" in obj)) return "researcher";
    if ("executive_summary" in obj && "key_findings" in obj) return "synthesizer";
    if ("status" in obj && ("pdf_location" in obj || "filename" in obj)) return "pdf_writer";
    // Must precede website_writer. A pdf_generator result also carries
    // success/s3_key/url, so without this discriminator a research report was
    // identified as a generated website and rendered with a "View Website"
    // button pointing at a PDF whose link had a one-hour life.
    if (obj.artifact === "pdf") return "pdf_document";
    if ("success" in obj && "s3_key" in obj && "url" in obj) return "website_writer";
    // The Services Catalog's website phase reports a different shape — `status`
    // and `website_url` rather than `success` and `url`, per
    // MENU_WEBSITE_WRITER_PROMPT. Without this the catalog's headline
    // deliverable rendered as a raw JSON block instead of a link to the site.
    if ("website_url" in obj && "s3_key" in obj) return "website_writer";

    return null;
}

/**
 * Strip JS-style comments from a JSON string so JSON.parse can handle
 * agent output that includes `// ...` or `/* ... *\/` comments.
 */
function stripJsonComments(str: string): string {
    // Remove single-line comments (// ...) that are NOT inside strings
    // Simple heuristic: remove lines where // appears outside of quoted values
    return str
        .replace(/^\s*\/\/.*$/gm, "") // full-line comments
        .replace(/,(\s*[}\]])/g, "$1"); // trailing commas before } or ]
}

/**
 * Try to parse a string as JSON, stripping comments if needed.
 * Returns the parsed object or null on failure.
 */
function tryParseJson(str: string): unknown {
    const trimmed = str.trim();
    // Fast path: try direct parse first
    try {
        return JSON.parse(trimmed);
    } catch {
        // Fallback: strip comments and trailing commas, then retry
        try {
            return JSON.parse(stripJsonComments(trimmed));
        } catch {
            return null;
        }
    }
}

/**
 * Try to detect a top-level JSON object in raw text (no fences).
 * Looks for text that starts with { and ends with } after trimming.
 */
function tryParseRawJson(text: string): ContentPart[] | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

    const parsed = tryParseJson(trimmed);
    if (!parsed) return null;

    const schema = identifySchema(parsed);
    if (!schema) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return [{ type: "structured", data: parsed as any, structuredType: schema }];
}

/**
 * Split a text string into content parts. Fenced ```json blocks that match
 * a known agent schema become structured parts; everything else stays as text.
 * Also detects raw (unfenced) JSON objects that match agent schemas.
 */
export function splitContent(text: string): ContentPart[] {
    const parts: ContentPart[] = [];
    // Match ```json ... ``` blocks (with optional whitespace)
    const fenceRegex = /```json\s*\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let foundFence = false;

    while ((match = fenceRegex.exec(text)) !== null) {
        foundFence = true;
        // Text before this code block
        const before = text.slice(lastIndex, match.index);
        if (before.trim()) {
            parts.push({ type: "text", content: before });
        }

        const jsonStr = match[1].trim();
        const parsed = tryParseJson(jsonStr);

        if (parsed) {
            const schema = identifySchema(parsed);
            if (schema) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                parts.push({ type: "structured", data: parsed as any, structuredType: schema });
            } else {
                // Valid JSON but unknown schema — keep the original fenced block
                parts.push({ type: "text", content: match[0] });
            }
        } else {
            // Failed parse — keep original fenced block
            parts.push({ type: "text", content: match[0] });
        }

        lastIndex = match.index + match[0].length;
    }

    // Trailing text
    const tail = text.slice(lastIndex);
    if (tail.trim()) {
        parts.push({ type: "text", content: tail });
    }

    // If no fenced blocks were found, try detecting raw JSON in the full text
    if (!foundFence) {
        const rawResult = tryParseRawJson(text);
        if (rawResult) return rawResult;
    }

    return parts.length > 0 ? parts : [{ type: "text", content: text }];
}
