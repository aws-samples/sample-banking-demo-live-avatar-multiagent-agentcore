import { useAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { Spinner } from "@cloudscape-design/components";
import { I18nProvider } from "@cloudscape-design/components/i18n";
import messages from "@cloudscape-design/components/i18n/messages/all.en";
import "@cloudscape-design/global-styles/index.css";
import { Amplify } from "aws-amplify";
import { fetchAuthSession } from "aws-amplify/auth";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Home from "./pages/Home";
import Login from "./pages/Login";

const apiConfig = {
    headers: async () => {
        return {
            Authorization: (await fetchAuthSession()).tokens?.idToken?.toString() ?? "",
        };
    },
};
Amplify.configure(
    {
        Auth: {
            Cognito: {
                userPoolId: import.meta.env.VITE_USER_POOL_ID,
                userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
                identityPoolId: import.meta.env.VITE_IDENTITY_POOL_ID,
                allowGuestAccess: false,
                loginWith: {
                    oauth: {
                        domain: import.meta.env.VITE_USER_POOL_DOMAIN_URL,
                        scopes: ["openid"],
                        redirectSignIn: [
                            "http://localhost:3000",
                            import.meta.env.VITE_CALLBACK_URL,
                        ],
                        redirectSignOut: [
                            "http://localhost:3000",
                            import.meta.env.VITE_CALLBACK_URL,
                        ],
                        responseType: "code",
                    },
                },
            },
        },
        API: {
            GraphQL: {
                endpoint: import.meta.env.VITE_GRAPH_API_URL,
                defaultAuthMode: "userPool",
            },
            REST: {
                restApi: {
                    endpoint: String(import.meta.env.VITE_REST_API_URL).slice(0, -1),
                },
            },
        },
        Storage: {
            S3: {
                region: import.meta.env.VITE_REGION,
                buckets: {
                    storageBucket: {
                        region: import.meta.env.VITE_REGION,
                        bucketName: import.meta.env.VITE_STORAGE_BUCKET_NAME,
                    },
                },
            },
        },
    },
    {
        API: {
            GraphQL: apiConfig,
            REST: apiConfig,
        },
    }
);

export default function App() {
    const { authStatus } = useAuthenticator((context) => [context.authStatus]);

    const router = createBrowserRouter([
        {
            path: "/",
            element: <Home />,
        },
    ]);

    return (
        <div>
            {authStatus === "configuring" && <Spinner />}
            {authStatus === "unauthenticated" && <Login />}
            {authStatus === "authenticated" && (
                <>
                    <I18nProvider locale={"en"} messages={[messages]}>
                        <RouterProvider router={router} />
                    </I18nProvider>
                </>
            )}
        </div>
    );
}
