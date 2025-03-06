import { ThemeProvider, useAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { AppLayout, Spinner } from "@cloudscape-design/components";
import { I18nProvider } from "@cloudscape-design/components/i18n";
import messages from "@cloudscape-design/components/i18n/messages/all.en";
import SideNavigation from "@cloudscape-design/components/side-navigation";
import "@cloudscape-design/global-styles/index.css";
import { Amplify } from "aws-amplify";
import { fetchAuthSession } from "aws-amplify/auth";
import { useEffect, useState } from "react";
import {
    createBrowserRouter,
    Outlet,
    RouterProvider,
    useLocation,
    useNavigate,
} from "react-router-dom";
import Bar from "./components/Bar";
import { FlashbarComponent, FlashbarProvider } from "./components/Notifications";
import Chat from "./pages/Chat";
import Gallery from "./pages/Gallery";
import Login from "./pages/Login";
import { isLocalhost } from "./utilities";

const LOCALE = "en";

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
                identityPoolId: import.meta.env.VITE_IDENTITY_POOL_ID, // REQUIRED only for Federated Authentication
                allowGuestAccess: false,
                // OPTIONAL - Set to true to use your identity pool's unauthenticated role for unauthenticated users.
                loginWith: {
                    // OPTIONAL - Hosted UI configuration
                    oauth: {
                        domain: import.meta.env.VITE_USER_POOL_DOMAIN_URL,
                        scopes: ["openid"],
                        redirectSignIn: isLocalhost
                            ? ["http://localhost:3000"]
                            : [import.meta.env.VITE_CALLBACK_URL],
                        redirectSignOut: isLocalhost
                            ? ["http://localhost:3000"]
                            : [import.meta.env.VITE_CALLBACK_URL],
                        responseType: "code", //REFRESH token will only be generated when the responseType is code.
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
                bucket: import.meta.env.VITE_STORAGE_BUCKET_NAME,
                region: import.meta.env.VITE_REGION,
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

const navigationConfig = [
    {
        path: "/",
        text: "Chat",
        element: <Chat />,
    },
    {
        path: "/gallery",
        text: "Gallery",
        element: <Gallery />,
    },
];

function NavigationComponent() {
    const location = useLocation();
    const [activeHref, setActiveHref] = useState(location.pathname);
    const navigate = useNavigate();

    useEffect(() => {
        setActiveHref(location.pathname);
    }, [location.pathname]);

    return (
        <SideNavigation
            activeHref={activeHref}
            onFollow={(event) => {
                if (!event.detail.external) {
                    event.preventDefault();
                    setActiveHref(event.detail.href);
                    navigate(event.detail.href);
                }
            }}
            items={[
                ...navigationConfig.map(({ path, text }) => ({
                    type: "link" as const,
                    text,
                    href: path,
                })),
                { type: "divider" as const },
                {
                    type: "link" as const,
                    text: "GitLab",
                    href: "https://gitlab.aws.dev/genai-labs/templates/demo-starter-kit",
                    external: true,
                },
            ]}
        />
    );
}

export default function App() {
    const { route, authStatus } = useAuthenticator((context) => [
        context.route,
        context.authStatus,
    ]);

    useEffect(() => {
        console.log("Config:", Amplify.getConfig());
        console.log("Route:", route);
        console.log("AuthStatus:", authStatus);
    }, [route, authStatus]);

    const [navigationOpen, setNavigationOpen] = useState<boolean>(true);

    const router = createBrowserRouter([
        {
            element: (
                <AppLayout
                    navigation={<NavigationComponent />}
                    navigationOpen={navigationOpen}
                    onNavigationChange={({ detail }) => setNavigationOpen(detail.open)}
                    notifications={<FlashbarComponent />}
                    toolsHide={true}
                    content={<Outlet />}
                />
            ),
            children: navigationConfig.map(({ path, element }) => ({
                path,
                element,
            })),
        },
    ]);

    return (
        <div>
            {authStatus === "configuring" && <Spinner />}
            {authStatus === "unauthenticated" && <Login />}
            {authStatus === "authenticated" && (
                <>
                    <I18nProvider locale={LOCALE} messages={[messages]}>
                        <Bar />
                        <ThemeProvider>
                            <FlashbarProvider>
                                <RouterProvider router={router} />
                            </FlashbarProvider>
                        </ThemeProvider>
                    </I18nProvider>
                </>
            )}
        </div>
    );
}
