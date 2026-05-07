/// <reference types="vite/client" />
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="react" />
/// <reference types="react-dom" />

// Re-export JSX namespace globally for React 19 compatibility
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { JSX } from "react";
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace JSX {
        type Element = import("react").JSX.Element;
        type IntrinsicElements = import("react").JSX.IntrinsicElements;
    }
}

interface ImportMetaEnv {
    readonly VITE_COGNITO_USER_POOL_ID?: string;
    readonly VITE_COGNITO_CLIENT_ID?: string;
    readonly VITE_COGNITO_REGION?: string;
    readonly VITE_COGNITO_REDIRECT_URI?: string;
    readonly VITE_COGNITO_POST_LOGOUT_REDIRECT_URI?: string;
    readonly VITE_COGNITO_RESPONSE_TYPE?: string;
    readonly VITE_COGNITO_SCOPE?: string;
    readonly VITE_COGNITO_AUTOMATIC_SILENT_RENEW?: string;
    readonly VITE_COGNITO_IDENTITY_PROVIDER?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
