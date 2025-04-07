import { Authenticator, Button, Divider, Flex, useAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { AppLayout, Flashbar, Spinner } from "@cloudscape-design/components";
import { I18nProvider } from "@cloudscape-design/components/i18n";
import messages from "@cloudscape-design/components/i18n/messages/all.en";
import SideNavigation from "@cloudscape-design/components/side-navigation";
import "@cloudscape-design/global-styles/index.css";
import { Amplify } from "aws-amplify";
import { fetchAuthSession, signInWithRedirect } from "aws-amplify/auth";
import { useContext, useEffect, useState } from "react";
import {
    createBrowserRouter,
    Outlet,
    RouterProvider,
    useLocation,
    useNavigate,
} from "react-router-dom";
import Amazicon from "./assets/amazicon.svg";
import Bar from "./components/Bar";
import { FlashbarContext, FlashbarProvider } from "./contexts/Flashbar";
import Chat from "./pages/Chat";
import Gallery from "./pages/Gallery";
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
                identityPoolId: import.meta.env.VITE_IDENTITY_POOL_ID, // REQUIRED only for Federated Authentication.
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

function Navigation() {
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

function Layout() {
    const [navigationOpen, setNavigationOpen] = useState<boolean>(true);
    const { flashbarItems, removeFlashbarItem } = useContext(FlashbarContext);

    return (
        <AppLayout
            navigation={<Navigation />}
            navigationOpen={navigationOpen}
            onNavigationChange={({ detail }) => setNavigationOpen(detail.open)}
            notifications={
                <Flashbar
                    items={flashbarItems.map((item, index) => ({
                        type: item.type,
                        dismissible: true,
                        dismissLabel: "Dismiss",
                        onDismiss: () => removeFlashbarItem(index),
                        content: item.content,
                    }))}
                    // stackItems
                />
            }
            stickyNotifications
            toolsHide={true}
            content={<Outlet />}
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

    const router = createBrowserRouter([
        {
            element: <Layout />,
            children: navigationConfig.map(({ path, element }) => ({
                path,
                element,
            })),
        },
    ]);

    return (
        <div>
            {authStatus === "configuring" && <Spinner />}
            {authStatus === "unauthenticated" && (
                <Authenticator
                    hideSignUp={true}
                    variation="modal"
                    // socialProviders={["amazon"]}
                    components={{
                        SignIn: {
                            Header: () => {
                                return (
                                    <Flex direction="column" padding="2rem 2rem 0">
                                        <Button
                                            onClick={() => signInWithRedirect()}
                                            gap="1rem"
                                            isFullWidth
                                        >
                                            <img
                                                src={Amazicon}
                                                alt="Amazon icon"
                                                style={{ width: "15px" }}
                                            />
                                            Sign in with Midway
                                        </Button>
                                        <Divider label="or" size="small" />
                                    </Flex>
                                );
                            },
                        },
                    }}
                />
            )}
            {authStatus === "authenticated" && (
                <>
                    <I18nProvider locale={LOCALE} messages={[messages]}>
                        <Bar />
                        <FlashbarProvider>
                            <RouterProvider router={router} />
                        </FlashbarProvider>
                    </I18nProvider>
                </>
            )}
        </div>
    );
}
