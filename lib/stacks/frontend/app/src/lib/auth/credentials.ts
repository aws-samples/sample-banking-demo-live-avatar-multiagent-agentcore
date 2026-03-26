/**
 * AWS temporary credentials via Cognito Identity Pool.
 *
 * Exchanges a Cognito ID token for short-lived AWS credentials
 * (accessKeyId, secretAccessKey, sessionToken) that can be used
 * for SigV4-signed requests (e.g., presigned WebSocket URLs).
 */

import {
    CognitoIdentityClient,
    GetIdCommand,
    GetCredentialsForIdentityCommand,
} from "@aws-sdk/client-cognito-identity";

export interface AWSCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration: Date;
}

let cachedCredentials: AWSCredentials | null = null;

/**
 * Get temporary AWS credentials by exchanging a Cognito ID token
 * through the Identity Pool enhanced auth flow.
 *
 * Results are cached and reused until 5 minutes before expiration.
 *
 * @param idToken - Cognito User Pool ID token (JWT)
 * @param identityPoolId - Cognito Identity Pool ID (e.g., us-east-1:uuid)
 * @param userPoolId - Cognito User Pool ID (e.g., us-east-1_abc123)
 * @param region - AWS region (e.g., us-east-1)
 */
export async function getAWSCredentials(
    idToken: string,
    identityPoolId: string,
    userPoolId: string,
    region: string
): Promise<AWSCredentials> {
    // Return cached credentials if still valid (5-minute buffer)
    if (cachedCredentials && cachedCredentials.expiration.getTime() - Date.now() > 5 * 60 * 1000) {
        return cachedCredentials;
    }

    const client = new CognitoIdentityClient({ region });

    const loginsKey = `cognito-idp.${region}.amazonaws.com/${userPoolId}`;

    // Step 1: Get an identity ID from the Identity Pool
    const { IdentityId } = await client.send(
        new GetIdCommand({
            IdentityPoolId: identityPoolId,
            Logins: {
                [loginsKey]: idToken,
            },
        })
    );

    if (!IdentityId) {
        throw new Error("Failed to get Cognito identity ID");
    }

    // Step 2: Exchange identity ID for temporary AWS credentials
    const { Credentials } = await client.send(
        new GetCredentialsForIdentityCommand({
            IdentityId,
            Logins: {
                [loginsKey]: idToken,
            },
        })
    );

    if (!Credentials?.AccessKeyId || !Credentials.SecretKey || !Credentials.SessionToken) {
        throw new Error("Failed to get AWS credentials from Identity Pool");
    }

    cachedCredentials = {
        accessKeyId: Credentials.AccessKeyId,
        secretAccessKey: Credentials.SecretKey,
        sessionToken: Credentials.SessionToken,
        expiration: Credentials.Expiration ?? new Date(Date.now() + 3600 * 1000),
    };

    return cachedCredentials;
}

/**
 * Clear the cached credentials (e.g., on sign-out).
 */
export function clearCachedCredentials(): void {
    cachedCredentials = null;
}
