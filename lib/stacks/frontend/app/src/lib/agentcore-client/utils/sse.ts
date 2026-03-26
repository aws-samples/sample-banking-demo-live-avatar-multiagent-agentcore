import type { ChunkParser, StreamCallback } from "../types";

/** Reads an SSE response stream, passing each line to the parser.
 *
 * Handles mid-stream connection drops gracefully — if the server closes the
 * chunked response unexpectedly (e.g. AgentCore proxy timeout), we process
 * whatever data was received rather than throwing to the caller.
 */
export async function readSSEStream(
    response: Response,
    parser: ChunkParser,
    callback: StreamCallback
): Promise<void> {
    let buffer = "";

    if (!response.body) {
        const text = await response.text();
        for (const line of text.split(/\r?\n/)) {
            if (line.trim()) {
                parser(line, callback);
            }
        }
        return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
        while (true) {
            let done: boolean;
            let value: Uint8Array | undefined;

            try {
                ({ done, value } = await reader.read());
            } catch (streamError) {
                // Mid-stream connection drop (e.g. "Error in input stream" from
                // AgentCore proxy timeout).  Process buffered data and exit
                // gracefully instead of throwing to the UI.
                console.warn("SSE stream interrupted:", streamError);
                break;
            }

            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (line.trim()) {
                    parser(line, callback);
                }
            }
        }

        if (buffer.trim()) {
            parser(buffer, callback);
        }
    } finally {
        reader.releaseLock();
    }
}
