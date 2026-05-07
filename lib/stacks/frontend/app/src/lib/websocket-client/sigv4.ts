/**
 * SigV4 presigning for AgentCore WebSocket URLs.
 *
 * Generates a presigned wss:// URL that authenticates the caller
 * via IAM credentials (from Cognito Identity Pool) instead of
 * bearer token subprotocols.
 *
 * Based on the aws-samples pattern for Bedrock AgentCore WebSocket auth.
 */

import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";
import type { AWSCredentials } from "@/lib/auth/credentials";

export interface PresignParams {
    /** Selected persona ID */
    persona?: string;
    /** Language code (e.g., en-US) */
    language?: string;
    /** Voice ID for TTS */
    voiceId?: string;
    /** Initial KB pipeline multi-select as a comma-separated string value */
    kbPipelines?: string[];
}

/**
 * Create a SigV4-presigned WebSocket URL for an AgentCore Runtime.
 *
 * @param runtimeArn - The AgentCore Runtime ARN
 * @param region - AWS region (e.g., us-east-1)
 * @param credentials - Temporary AWS credentials from Identity Pool
 * @param sessionId - Session ID for continuity
 * @param params - Optional persona, language, voiceId query params
 * @returns A presigned wss:// URL string
 */
export async function presignAgentCoreWebSocket(
    runtimeArn: string,
    region: string,
    credentials: AWSCredentials,
    sessionId: string,
    params?: PresignParams
): Promise<string> {
    const host = `bedrock-agentcore.${region}.amazonaws.com`;
    const path = `/runtimes/${encodeURIComponent(runtimeArn)}/ws`;

    // Build query parameters
    const query: Record<string, string> = {
        session_id: sessionId,
    };
    if (params?.persona) {
        query.persona = params.persona;
    }
    if (params?.language) {
        query.language = params.language;
    }
    if (params?.voiceId) {
        query.voice_id = params.voiceId;
    }

    const signer = new SignatureV4({
        service: "bedrock-agentcore",
        region,
        credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken,
        },
        sha256: Sha256,
    });

    const request = new HttpRequest({
        method: "GET",
        protocol: "https:",
        hostname: host,
        path,
        query,
        headers: {
            host,
        },
    });

    const signed = await signer.presign(request, {
        expiresIn: 300, // 5 minutes
    });

    // Reconstruct URL from signed request, converting https to wss
    const queryString = Object.entries(signed.query ?? {})
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&");

    return `wss://${host}${signed.path}?${queryString}`;
}
