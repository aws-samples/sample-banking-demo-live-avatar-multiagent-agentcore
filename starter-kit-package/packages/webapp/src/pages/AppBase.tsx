import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useAtom } from "jotai";
import { ToastContainer, Slide } from "react-toastify"
import { infoDrawerAtom, navDrawerAtom, splitPanelAtom, themeAtom } from "../atoms/AppAtoms";
import TopBar from "../components/TopBar";
import { BrowserRouter } from "react-router-dom";
import I18nProvider from "@cloudscape-design/components/i18n";
import messages from "@cloudscape-design/components/i18n/messages/all.all";
import { AppLayout } from "@cloudscape-design/components";
import { PageContent, InfoContent, AppSideNavigation } from "./PageNavigation";
import { applyMode } from "@cloudscape-design/global-styles";

const LOCALE = 'en';
const appLayoutLabels = {
    navigation: 'Side navigation',
    navigationToggle: 'Open side navigation',
    navigationClose: 'Close side navigation',
    notifications: 'Notifications',
    tools: 'Help panel',
    toolsToggle: 'Open help panel',
    toolsClose: 'Close help panel',
};

export const AppBase = () => {
    // Create a client
    const queryClient = new QueryClient()
    // atoms
    const [theme] = useAtom(themeAtom);
    const [navDrawer, setNavDrawer] = useAtom(navDrawerAtom);
    const [infoDrawer, setInfoDrawer] = useAtom(infoDrawerAtom);

    const [showSplitPanel, setShowSplitPanel] = useAtom(splitPanelAtom)

    // theme control
    applyMode(theme);

    return (
        <QueryClientProvider client={queryClient}>
            <ToastContainer position="bottom-left"
                hideProgressBar={false}
                newestOnTop={true}
                closeOnClick
                rtl={false}
                pauseOnFocusLoss={false}
                draggable
                pauseOnHover
                theme={theme}
                transition={Slide}
            />
            <BrowserRouter>
                <I18nProvider locale={LOCALE} messages={[messages]}>
                    <TopBar />
                    <AppLayout
                        content={<PageContent />}
                        // breadcrumbs={<> Page Crumbs </>}
                        // splitPanelOpen={showSplitPanel}
                        // splitPanel={<SplitPanelPage />}
                        // onSplitPanelToggle={() => setShowSplitPanel(!showSplitPanel)}
                        navigationOpen={navDrawer}
                        navigation={<AppSideNavigation />}
                        onNavigationChange={({ detail }) => setNavDrawer(detail.open)}
                        tools={<InfoContent />}
                        toolsOpen={infoDrawer}
                        onToolsChange={({ detail }) => setInfoDrawer(detail.open)}
                        contentType="default"
                        ariaLabels={appLayoutLabels}
                        notifications={[]} // stack page level notifications here
                    />
                </I18nProvider>
            </BrowserRouter>
        </QueryClientProvider>

    )
}