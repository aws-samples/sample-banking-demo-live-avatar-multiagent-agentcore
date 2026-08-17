/**
 * Text-to-speech via Amazon Polly's generative engine.
 *
 * Replaces the browser Web Speech API for the AI Assistant's read-aloud: the
 * browser voices are robotic and vary by OS/browser, so the demo sounded
 * different on every machine. Polly's generative engine gives one consistent,
 * natural voice everywhere.
 *
 * Credentials come from the Cognito Identity Pool (the same short-lived AWS
 * creds the avatar's SigV4 path uses), so the call is authenticated per user
 * with no long-lived secret in the browser.
 */

import { PollyClient, SynthesizeSpeechCommand, type Engine } from "@aws-sdk/client-polly";
import { getAWSCredentials } from "@/lib/auth/credentials";

/**
 * Default voice. Ruth is an en-US NEURAL/generative voice; the generative
 * engine renders it with natural prosody. Kept in one place so the whole
 * experience speaks in a single, recognizable voice.
 */
export const POLLY_VOICE_ID = "Ruth";
const POLLY_ENGINE: Engine = "generative";

export interface PollyConfig {
    idToken: string;
    identityPoolId: string;
    userPoolId: string;
    region: string;
}

/** True when the Identity Pool env is present so Polly can be reached. */
export function pollyConfigured(): boolean {
    return Boolean(
        import.meta.env.VITE_IDENTITY_POOL_ID && import.meta.env.VITE_COGNITO_USER_POOL_ID
    );
}

/**
 * Synthesize `text` to MP3 bytes with the generative voice.
 *
 * Returns a Blob the caller can turn into an object URL and play. Throws on
 * failure so the hook can fall back rather than sit silent.
 */
export async function synthesizeSpeech(text: string, config: PollyConfig): Promise<Blob> {
    const credentials = await getAWSCredentials(
        config.idToken,
        config.identityPoolId,
        config.userPoolId,
        config.region
    );

    const client = new PollyClient({
        region: config.region,
        credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken,
        },
    });

    const result = await client.send(
        new SynthesizeSpeechCommand({
            Text: text,
            OutputFormat: "mp3",
            VoiceId: POLLY_VOICE_ID,
            Engine: POLLY_ENGINE,
        })
    );

    if (!result.AudioStream) {
        throw new Error("Polly returned no audio stream");
    }

    // The SDK streams bytes; collect them into a Blob for an <audio> element.
    // Copy into a fresh ArrayBuffer so the Blob part is typed as ArrayBuffer
    // (the stream's Uint8Array is backed by ArrayBufferLike, which the DOM Blob
    // type rejects under strict TS).
    const bytes = await result.AudioStream.transformToByteArray();
    const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    return new Blob([buffer], { type: "audio/mpeg" });
}
