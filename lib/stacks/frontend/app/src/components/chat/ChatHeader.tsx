import { useState } from "react";
import Button from "@cloudscape-design/components/button";
import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Header from "@cloudscape-design/components/header";
import { useAuth } from "@/hooks/useAuth";
import { ResearchDepthSelector } from "./ResearchDepthSelector";

type ChatHeaderProps = {
    title?: string | undefined;
    onNewChat: () => void;
    canStartNewChat: boolean;
    mode?: string;
};

export function ChatHeader({
    title,
    onNewChat,
    canStartNewChat,
    mode,
}: ChatHeaderProps): JSX.Element {
    const { isAuthenticated, signOut } = useAuth();
    const [logoutVisible, setLogoutVisible] = useState(false);
    const isResearchMode = mode === "research" || mode === "generic_research";

    return (
        <div className="border-b p-4">
            <Header
                actions={
                    <SpaceBetween direction="horizontal" size="xs">
                        {isResearchMode && <ResearchDepthSelector />}
                        <Button onClick={onNewChat} disabled={!canStartNewChat} iconName="add-plus">
                            New Chat
                        </Button>
                        {isAuthenticated && (
                            <Button variant="normal" onClick={() => setLogoutVisible(true)}>
                                Logout
                            </Button>
                        )}
                    </SpaceBetween>
                }
            >
                {title || "Research Agent"}
            </Header>

            <Modal
                visible={logoutVisible}
                onDismiss={() => setLogoutVisible(false)}
                header="Confirm Logout"
                footer={
                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button variant="link" onClick={() => setLogoutVisible(false)}>
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={() => {
                                    setLogoutVisible(false);
                                    signOut();
                                }}
                            >
                                Confirm
                            </Button>
                        </SpaceBetween>
                    </Box>
                }
            >
                Are you sure you want to log out? You will need to sign in again to access your
                account.
            </Modal>
        </div>
    );
}
