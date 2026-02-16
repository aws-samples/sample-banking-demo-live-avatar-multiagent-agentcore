import TopNavigation from "@cloudscape-design/components/top-navigation";
import { fetchAuthSession, signOut } from "aws-amplify/auth";
import { useEffect, useState } from "react";
import AboutModal from "./AboutModal";

const TopBar = () => {
    const [email, setEmail] = useState<string>("");
    const [showAboutModal, setShowAboutModal] = useState(false);

    useEffect(() => {
        const getEmail = async () => {
            const session = await fetchAuthSession();
            const payload = session.tokens?.idToken?.payload;
            setEmail((payload?.email as string) || "");
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
