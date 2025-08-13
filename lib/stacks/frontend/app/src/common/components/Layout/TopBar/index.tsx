import { TopNavigation } from "@cloudscape-design/components";
import { applyMode, Mode } from "@cloudscape-design/global-styles";
import { getCurrentUser, signOut } from "aws-amplify/auth";
import { useEffect, useState } from "react";
import Favicon from "./favicon.png";

const APP_NAME = "Demo Starter Kit";

const TopBar = () => {
    const [theme, setTheme] = useState<Mode>(() => {
        const savedTheme = localStorage.getItem("theme");
        return savedTheme === "dark" ? Mode.Dark : Mode.Light;
    });

    useEffect(() => {
        localStorage.setItem("theme", theme);
        applyMode(theme);
    }, [theme]);

    const [email, setEmail] = useState<string>("");

    useEffect(() => {
        const getEmail = async () => {
            const user = await getCurrentUser();
            if (user.username.startsWith("Amazon")) {
                setEmail(`${user.username.split("_")[1]}@amazon.com`);
            } else {
                setEmail(user.signInDetails?.loginId || user.username);
            }
        };
        getEmail();
    }, []);

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
                        onItemClick: ({ detail }) => {
                            if (detail.id === "switch-theme") {
                                setTheme(theme === Mode.Light ? Mode.Dark : Mode.Light);
                            }
                        },
                        items: [
                            {
                                id: "switch-theme",
                                text: theme === Mode.Light ? "🌑  Dark Theme" : "☀️ Light Theme",
                            },
                        ],
                    },
                    {
                        type: "menu-dropdown",
                        iconName: "user-profile",
                        items: [
                            {
                                id: "user",
                                text: email,
                                items: [{ id: "signout", text: "Sign out" }],
                            },
                        ],
                        onItemClick: async ({ detail }) => {
                            if (detail.id === "signout") {
                                try {
                                    await signOut();
                                } catch (error) {
                                    console.log("Failed to sign out: ", error);
                                }
                            }
                        },
                    },
                ]}
            />
        </div>
    );
};

export default TopBar;
