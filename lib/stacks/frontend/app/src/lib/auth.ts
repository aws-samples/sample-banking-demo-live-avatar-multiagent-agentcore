import { WebStorageStateStore } from "oidc-client-ts";

type AwsExportsConfig = {
    authority?: string;
    client_id?: string;
    redirect_uri?: string;
    post_logout_redirect_uri?: string;
    response_type?: string;
    scope?: string;
    automaticSilentRenew?: boolean;
    userStore: WebStorageStateStore | undefined;
};

let configCache: AwsExportsConfig | null = null;
let configPromise: Promise<AwsExportsConfig | null> | null = null;

async function loadAwsConfig(): Promise<AwsExportsConfig | null> {
    if (configCache) {
        return configCache;
    }

    if (configPromise) {
        return configPromise;
    }

    configPromise = (async () => {
        // Optional fallback only. The authoritative auth config comes from the
        // baked VITE_COGNITO_* env vars (see createCognitoAuthConfig). This
        // file is not deployed, so a miss is expected — fail quietly and let
        // the env vars take over. (Previously this logged an error and threw,
        // producing a noisy "Unexpected token '<'" when CloudFront returned
        // index.html for the missing file.)
        try {
            const response = await fetch("/aws-exports.json");
            const contentType = response.headers.get("content-type") ?? "";
            if (!response.ok || !contentType.includes("application/json")) {
                return null;
            }
            const config = await response.json();
            configCache = config;
            return config;
        } catch {
            return null;
        }
    })();

    return configPromise;
}

export async function createCognitoAuthConfig(): Promise<AwsExportsConfig> {
    const awsConfig = await loadAwsConfig().catch(() => null);

    const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
    const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
    const region = import.meta.env.VITE_COGNITO_REGION;
    const redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI;
    const postLogoutRedirectUri = import.meta.env.VITE_COGNITO_POST_LOGOUT_REDIRECT_URI;
    const responseType = import.meta.env.VITE_COGNITO_RESPONSE_TYPE;
    const scope = import.meta.env.VITE_COGNITO_SCOPE;
    const automaticSilentRenew = import.meta.env.VITE_COGNITO_AUTOMATIC_SILENT_RENEW;

    const envAuthority =
        region && userPoolId
            ? `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`
            : undefined;

    return {
        authority: envAuthority || awsConfig?.authority,
        client_id: clientId || awsConfig?.client_id,
        redirect_uri: redirectUri || awsConfig?.redirect_uri,
        post_logout_redirect_uri:
            postLogoutRedirectUri || redirectUri || awsConfig?.post_logout_redirect_uri,
        response_type: responseType || awsConfig?.response_type || "code",
        scope: scope || awsConfig?.scope || "email openid profile",
        automaticSilentRenew:
            automaticSilentRenew === "false"
                ? false
                : automaticSilentRenew === "true"
                  ? true
                  : (awsConfig?.automaticSilentRenew ?? true),
        userStore:
            typeof window !== "undefined"
                ? new WebStorageStateStore({ store: window.localStorage })
                : undefined,
    };
}

export const cognitoAuthConfig = {
    authority: `https://cognito-idp.${import.meta.env.VITE_COGNITO_REGION}.amazonaws.com/${import.meta.env.VITE_COGNITO_USER_POOL_ID}`,
    client_id: import.meta.env.VITE_COGNITO_CLIENT_ID,
    redirect_uri: import.meta.env.VITE_COGNITO_REDIRECT_URI,
    post_logout_redirect_uri: import.meta.env.VITE_COGNITO_REDIRECT_URI,
    response_type: "code",
    scope: "email openid profile",
    automaticSilentRenew: true,
    userStore:
        typeof window !== "undefined"
            ? new WebStorageStateStore({ store: window.localStorage })
            : undefined,
};
