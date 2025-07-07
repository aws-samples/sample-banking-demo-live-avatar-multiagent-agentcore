import "@aws-amplify/ui-react/styles.css";
import SideNavigation from "@cloudscape-design/components/side-navigation";
import "@cloudscape-design/global-styles/index.css";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const SideBar = () => {
    const location = useLocation();
    const [activeHref, setActiveHref] = useState(location.pathname);
    const navigate = useNavigate();

    useEffect(() => {
        setActiveHref(location.pathname);
    }, [location.pathname]);

    return (
        <SideNavigation
            activeHref={activeHref}
            onFollow={(event) => {
                if (!event.detail.external) {
                    event.preventDefault();
                    setActiveHref(event.detail.href);
                    navigate(event.detail.href);
                }
            }}
            items={[
                {
                    type: "link" as const,
                    text: "Chat",
                    href: "/",
                },
                {
                    type: "link" as const,
                    text: "Gallery",
                    href: "/gallery",
                },
                { type: "divider" as const },
                {
                    type: "link" as const,
                    text: "GitLab",
                    href: "https://gitlab.aws.dev/genai-labs/templates/demo-starter-kit",
                    external: true,
                },
            ]}
        />
    );
};

export default SideBar;
