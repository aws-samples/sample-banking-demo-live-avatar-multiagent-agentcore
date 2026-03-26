import type { AgentCoreConfig, AgentPattern, ChunkParser, StreamCallback } from "./types";
import { parseStrandsChunk } from "./parsers/strands";
import { parseLanggraphChunk } from "./parsers/langgraph";
import { readSSEStream } from "./utils/sse";

const PARSERS: Record<AgentPattern, ChunkParser> = {
    "strands-single-agent": parseStrandsChunk,
    "langgraph-single-agent": parseLanggraphChunk,
};

export class AgentCoreClient {
    private runtimeArn: string;
    private region: string;
    private parser: ChunkParser;

    constructor(config: AgentCoreConfig) {
        this.runtimeArn = config.runtimeArn;
        this.region = config.region ?? "us-east-1";
        this.parser = PARSERS[config.pattern];
    }

    generateSessionId(): string {
        return crypto.randomUUID();
    }

    async invoke(
        query: string,
        sessionId: string,
        accessToken: string,
        onEvent: StreamCallback,
        options?: { mode?: string; modelId?: string; [key: string]: unknown }
    ): Promise<void> {
        if (!accessToken) throw new Error("No valid access token found.");
        if (!this.runtimeArn) throw new Error("Agent Runtime ARN not configured.");

        const host = `bedrock-agentcore.${this.region}.amazonaws.com`;
        const urlPath = `/runtimes/${encodeURIComponent(this.runtimeArn)}/invocations`;

        // Build request body — includes standard fields plus any extra properties
        const { mode, modelId, ...extra } = options ?? {};
        const bodyObj: Record<string, unknown> = {
            prompt: query,
            runtimeSessionId: sessionId,
            ...extra,
        };
        if (mode) {
            bodyObj.mode = mode;
        }
        if (modelId) {
            bodyObj.model_id = modelId;
        }

        const bodyStr = JSON.stringify(bodyObj);
        const url = `https://${host}${urlPath}?qualifier=DEFAULT`;
        const traceId = `1-${Math.floor(Date.now() / 1000).toString(16)}-${crypto.randomUUID()}`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "X-Amzn-Trace-Id": traceId,
                "Content-Type": "application/json",
                Accept: "text/event-stream",
                "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
            },
            body: bodyStr,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        await readSSEStream(response, this.parser, onEvent);
    }
}
