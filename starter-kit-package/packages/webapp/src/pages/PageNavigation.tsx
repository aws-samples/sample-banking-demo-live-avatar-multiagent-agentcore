import { SideNavigation } from "@cloudscape-design/components";
// router
import { useLocation, useNavigate, Routes, Route, } from "react-router-dom";
import { Home } from "./Home";
import { Chat } from "./Chat";
import { appName } from "../atoms/AppAtoms";
import { Demo } from "./Demo";
import { InfoPanel } from "../components/InfoPanel";

export const AppRoutes = {
    home: {
        text: "Home",
        href: "/",
    },
    demo: {
        text: "Playground",
        href: "/demo",

    },
    chat: {
        text: "Chat",
        href: "/chat",
    }
}

export const AppSideNavigation = () => {
    const location = useLocation();
    const navigate = useNavigate();
    return (

        <SideNavigation
            activeHref={location.pathname}
            header={{ href: "/", text: appName }}
            onFollow={(event) => {
                if (!event.detail.external) {
                    event.preventDefault();
                    navigate(event.detail.href);
                }
            }}
            items={[
                { type: "link", text: AppRoutes.home.text, href: AppRoutes.home.href },
                {
                    type: "section",
                    text: "Demos",
                    items: [
                        {
                            type: "link", text: AppRoutes.demo.text, href: AppRoutes.demo.href
                        },
                        {
                            type: "link", text: AppRoutes.chat.text, href: AppRoutes.chat.href
                        },

                    ]
                },


                {
                    type: 'divider'
                },
                {
                    type: "link",
                    text: "Version 1.0",
                    href: "#"
                }
            ]}
        />
    );
}


export const PageContent = () => {
    return (
        <Routes>
            <Route path={AppRoutes.home.href} element={<Home />} />
            <Route path={AppRoutes.demo.href} element={<Demo />} />
            <Route path={AppRoutes.chat.href} element={<Chat />} />
        </Routes>
    )
}

export const InfoContent = () => {
    return (
        <Routes>
            {/* you can dynamically change help panel content based on route/page */}
            <Route path="*" element={<InfoPanel />} />
        </Routes>)
}