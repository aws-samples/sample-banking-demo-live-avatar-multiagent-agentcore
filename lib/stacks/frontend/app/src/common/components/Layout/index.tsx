import "@aws-amplify/ui-react/styles.css";
import { AppLayout, AppLayoutProps } from "@cloudscape-design/components";
import "@cloudscape-design/global-styles/index.css";
import TopBar from "./TopBar";

const Layout = (props: AppLayoutProps) => {
    return (
        <>
            <TopBar />
            <AppLayout
                navigationHide
                stickyNotifications
                toolsHide={true}
                contentType="cards"
                {...props}
            />
        </>
    );
};

export default Layout;
