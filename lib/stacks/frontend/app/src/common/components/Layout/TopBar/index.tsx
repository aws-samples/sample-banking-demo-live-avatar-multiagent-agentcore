import { TopNavigation } from "@cloudscape-design/components";
import { getCurrentUser, signOut } from "aws-amplify/auth";
import { useEffect, useState } from "react";
import AboutModal from "./AboutModal";

const TopBar = () => {
    const [email, setEmail] = useState<string>("");
    const [showAboutModal, setShowAboutModal] = useState(false);

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
        <>
            {" "}
            <TopNavigation
                identity={{ href: "#" }}
                utilities={[
                    {
                        type: "menu-dropdown",
                        iconName: "settings",
                        title: "Settings",
                        onItemClick: ({ detail }) => {
                            if (detail.id === "about") {
                                setShowAboutModal(true);
                            }
                        },
                        items: [
                            {
                                id: "about",
                                text: "About",
                                iconName: "status-info",
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
            <AboutModal visible={showAboutModal} onDismiss={() => setShowAboutModal(false)} />
        </>
    );
};

export default TopBar;
