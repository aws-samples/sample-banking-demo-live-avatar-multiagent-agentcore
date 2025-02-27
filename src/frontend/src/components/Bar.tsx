import { useAuthenticator } from "@aws-amplify/ui-react";
import { ButtonDropdownProps, TopNavigation } from "@cloudscape-design/components";
import { applyMode, Mode } from "@cloudscape-design/global-styles";
import { getCurrentUser } from "aws-amplify/auth";
import { useEffect, useState } from "react";
import Favicon from "../assets/favicon.png";

const APP_NAME = "Demo Starter Kit";

interface AuthedUser {
    userName: string;
    userID: string;
}

export default function Bar() {
    const [theme, setTheme] = useState<Mode>(() => {
        const savedTheme = localStorage.getItem("theme");
        return savedTheme === "dark" ? Mode.Dark : Mode.Light;
    });

    const { user, authStatus, signOut } = useAuthenticator((context) => [context.user]);
    const [authedUser, setAuthedUser] = useState<AuthedUser | null>(null);

    const currentAuthenticatedUser = async () => {
        try {
            if (!user) {
                const { username, userId } = await getCurrentUser();
                setAuthedUser({
                    userName: username,
                    userID: userId,
                });
            } else if (user.username.includes("AmazonFederate")) {
                setAuthedUser({
                    userName: `${user.username.split("_")[1]}@amazon.com`,
                    userID: user.userId,
                });
            } else if (user.username) {
                setAuthedUser({
                    userName: user.username,
                    userID: user.userId,
                });
            } else {
                setAuthedUser(null);
            }
        } catch (error) {
            console.log(error);
        }
        return null;
    };

    useEffect(() => {
        currentAuthenticatedUser();
    }, [authStatus, user]);

    useEffect(() => {
        localStorage.setItem("theme", theme);
        applyMode(theme);
    }, [theme]);

    async function handleSignOut() {
        try {
            await signOut();
        } catch (error) {
            console.log("error signing out: ", error);
        }
    }

    const handleSettingsClick = (detail: ButtonDropdownProps.ItemClickDetails) => {
        if (detail.id === "switch-theme") {
            setTheme(theme === Mode.Light ? Mode.Dark : Mode.Light);
        }
    };

    const handleMenuItemClick = (detail: ButtonDropdownProps.ItemClickDetails) => {
        if (detail.id === "signout") {
            handleSignOut();
        }
    };

    return (
        <div
            style={{
                borderBottom:
                    theme === Mode.Dark
                        ? "2px solid var(--color-border-divider-default-cx07f2)"
                        : "none",
            }}
        >
            <TopNavigation
                identity={{
                    href: "/",
                    title: APP_NAME,
                    logo: {
                        src: Favicon,
                        alt: APP_NAME,
                    },
                }}
                utilities={[
                    {
                        type: "menu-dropdown",
                        iconName: "settings",
                        ariaLabel: "Settings",
                        title: "Settings",
                        onItemClick: ({ detail }) => handleSettingsClick(detail),
                        items: [
                            {
                                id: "switch-theme",
                                text: theme === Mode.Light ? "🌙  Dark Theme" : "💡 Light Theme",
                            },
                        ],
                    },
                    {
                        type: "menu-dropdown",
                        text: authedUser?.userName ?? "",
                        iconName: "user-profile",
                        items: [
                            {
                                id: "support-group",
                                text: "Support",
                                items: [
                                    {
                                        id: "documentation",
                                        text: "Documentation",
                                        href: "https://w.amazon.com/bin/view/Internal-GenAI-Labs",
                                        external: true,
                                        externalIconAriaLabel: " (opens in new tab)",
                                    },
                                    {
                                        id: "feedback",
                                        text: "Feedback",
                                        href: "https://aws.amazon.com/contact-us/?cmpid=docs_headercta_contactus",
                                        external: true,
                                        externalIconAriaLabel: " (opens in new tab)",
                                    },
                                ],
                            },
                            { id: "signout", text: "Sign out" },
                        ],
                        onItemClick: ({ detail }) => handleMenuItemClick(detail),
                    },
                ]}
                i18nStrings={{
                    searchIconAriaLabel: "Search",
                    searchDismissIconAriaLabel: "Close search",
                    overflowMenuTriggerText: "More",
                    overflowMenuTitleText: "All",
                    overflowMenuBackIconAriaLabel: "Back",
                    overflowMenuDismissIconAriaLabel: "Close menu",
                }}
            />
        </div>
    );
}
