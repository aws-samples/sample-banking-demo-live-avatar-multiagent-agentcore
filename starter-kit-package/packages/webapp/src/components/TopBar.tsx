import { useEffect } from "react";
import { TopNavigation, ButtonDropdownProps } from "@cloudscape-design/components";
import { Mode } from '@cloudscape-design/global-styles';
// atoms
import { useAtom } from 'jotai';
import { appName, authedUserAtom, themeAtom, toggleThemeAtom } from '../atoms/AppAtoms';
import { useAuthenticator } from '@aws-amplify/ui-react';

import { getCurrentUser } from 'aws-amplify/auth';
import Favicon from "../assets/favicon.png"


export default function TopBar() {
    // atoms
    const [theme] = useAtom(themeAtom);
    const [, toggleTheme] = useAtom(toggleThemeAtom);
    const { user, authStatus, signOut } = useAuthenticator((context) => [context.user]);
    const [authedUser, setAuthedUser] = useAtom(authedUserAtom)



    const currentAuthenticatedUser = async () => {
        try {
            if (!user) {
                const { username, userId } = await getCurrentUser()
                setAuthedUser({
                    userName: username,
                    userID: userId,
                })

            } else if (user.username.includes("AmazonFederate")) {
                setAuthedUser({
                    userName: `${user.username.split("_")[1]}@amazon.com`,
                    userID: user.userId,
                })
            } else if (user.username) {
                setAuthedUser({
                    userName: user.username,
                    userID: user.userId,
                })
            } else {
                setAuthedUser(null)
            }

        } catch (err) {
            console.log(err);
        }
        return null
    }

    useEffect(() => {
        currentAuthenticatedUser()

    }, [authStatus, user])


    async function handleSignOut() {
        try {
            await signOut();
        } catch (error) {
            console.log('error signing out: ', error);
        }
    }

    const handleSettingsClick = (detail: ButtonDropdownProps.ItemClickDetails) => {
        if (detail.id === "switch-theme") {
            toggleTheme();
        }
    }

    const handleMenuItemClick = (detail: ButtonDropdownProps.ItemClickDetails) => {
        if (detail.id === "signout") {
            handleSignOut();
        }
    }

    return (
        <TopNavigation
            identity={{
                href: "/",
                title: appName,
                logo: {
                    src: Favicon,
                    alt: appName
                }
            }}
            utilities={[

                {
                    type: "button",
                    iconName: "notification",
                    title: "Notifications",
                    ariaLabel: "Notifications (unread)",
                    badge: false,
                    disableUtilityCollapse: false
                },
                {
                    type: "menu-dropdown",
                    iconName: "settings",
                    ariaLabel: "Settings",
                    title: "Settings",
                    onItemClick: ({ detail }) => handleSettingsClick(detail),
                    items: [
                        {
                            id: "switch-theme",
                            text: theme === Mode.Light ? "🌙  Dark Theme" : "💡 Light Theme"
                        }

                    ]
                },
                {
                    type: "menu-dropdown",
                    // text: `${userAttributes?.given_name ?? ""} ${userAttributes?.family_name ?? ""}`,
                    // description: `${userAttributes?.email ?? ""}`,
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
                                    href: "https://aws.amazon.com/bedrock/",
                                    external: true,
                                    externalIconAriaLabel:
                                        " (opens in new tab)"
                                },
                                {
                                    id: "feedback",
                                    text: "Feedback",
                                    href: "https://aws.amazon.com/contact-us/?cmpid=docs_headercta_contactus",
                                    external: true,
                                    externalIconAriaLabel:
                                        " (opens in new tab)"
                                }
                            ]
                        },
                        { id: "signout", text: "Sign out" }
                    ],
                    onItemClick: ({ detail }) => handleMenuItemClick(detail),
                }
            ]}
            i18nStrings={{
                searchIconAriaLabel: "Search",
                searchDismissIconAriaLabel: "Close search",
                overflowMenuTriggerText: "More",
                overflowMenuTitleText: "All",
                overflowMenuBackIconAriaLabel: "Back",
                overflowMenuDismissIconAriaLabel: "Close menu"
            }}
        />
    )

}