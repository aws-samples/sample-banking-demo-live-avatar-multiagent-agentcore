import { AgentCoreClient } from "@/lib/agentcore-client";
import type { AgentPattern, StreamEvent } from "@/lib/agentcore-client";

/**
 * A/B testing across models for the AI Assistant.
 *
 * Runs the SAME prompt against two models via the orchestrator's chatbot mode
 * and returns each model's full text output for side-by-side comparison. This
 * is the "A/B testing validation to test the output with various models" the
 * demo is required to show. Client-side dual-invoke — no new backend.
 */

export interface AbVariantResult {
    modelId: string;
    text: string;
    /** Wall-clock generation time in ms. */
    elapsedMs: number;
    error?: string;
}

export interface AbCompareResult {
    a: AbVariantResult;
    b: AbVariantResult;
}

function buildClient(): AgentCoreClient {
    const runtimeArn = import.meta.env.VITE_RUNTIME_ARN_ORCHESTRATOR;
    if (!runtimeArn) {
        throw new Error("Agent Runtime ARN not configured.");
    }
    return new AgentCoreClient({
        runtimeArn,
        region: import.meta.env.VITE_REGION || "us-east-1",
        pattern: "strands-single-agent" as AgentPattern,
    });
}

async function runVariant(
    client: AgentCoreClient,
    prompt: string,
    modelId: string,
    accessToken: string
): Promise<AbVariantResult> {
    const started = Date.now();
    let text = "";
    try {
        await client.invoke(
            prompt,
            client.generateSessionId(),
            accessToken,
            (event: StreamEvent) => {
                if (event.type === "text" || event.type === "agent_text") {
                    text += event.content;
                }
            },
            { mode: "chatbot", modelId }
        );
        return { modelId, text: text.trim(), elapsedMs: Date.now() - started };
    } catch (err) {
        return {
            modelId,
            text: text.trim(),
            elapsedMs: Date.now() - started,
            error: err instanceof Error ? err.message : "Generation failed",
        };
    }
}

/**
 * Generate the same prompt under two models in parallel.
 */
export async function compareModels(params: {
    prompt: string;
    modelA: string;
    modelB: string;
    accessToken: string;
}): Promise<AbCompareResult> {
    const { prompt, modelA, modelB, accessToken } = params;
    const client = buildClient();
    const [a, b] = await Promise.all([
        runVariant(client, prompt, modelA, accessToken),
        runVariant(client, prompt, modelB, accessToken),
    ]);
    return { a, b };
}

/**
 * Build the description-generation prompt for a single catalog item. Kept in
 * one place so both variants receive an identical prompt (fair A/B).
 */
export function buildDescriptionPrompt(itemName: string): string {
    return (
        `Write a single, client-facing product description (one sentence, 15-30 words, ` +
        `benefit-led, on-brand for Trinity Reserve Bank) for "${itemName}". ` +
        `Return only the description text — no preamble, no quotes, no markdown.`
    );
}
