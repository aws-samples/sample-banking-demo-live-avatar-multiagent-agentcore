import "@aws-amplify/ui-react/styles.css";
import { AppLayout, AppLayoutProps, Flashbar } from "@cloudscape-design/components";
import "@cloudscape-design/global-styles/index.css";
import { useContext, useState } from "react";
import { FlashbarContext } from "../../contexts/Flashbar";
import SideBar from "./SideBar";
import TopBar from "./TopBar";

const Layout = (props: AppLayoutProps) => {
    const [navigationOpen, setNavigationOpen] = useState<boolean>(true);
    const { flashbarItems, removeFlashbarItem } = useContext(FlashbarContext);

    return (
        <>
            <TopBar />
            <AppLayout
                navigation={<SideBar />}
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
                contentType="cards"
                {...props}
            />
        </>
    );
};

export default Layout;
