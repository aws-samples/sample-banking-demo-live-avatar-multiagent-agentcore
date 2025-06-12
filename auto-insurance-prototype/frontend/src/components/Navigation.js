import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { SideNavigation } from "@cloudscape-design/components";

function Navigation() {
    const navigate = useNavigate();
    const location = useLocation();
    const [activeHref, setActiveHref] = useState(location.pathname);

    const handleFollow = (event) => {
        if (!event.detail.external) {
            event.preventDefault();
            setActiveHref(event.detail.href);
            navigate(event.detail.href);
        }
    };

    return (
        <SideNavigation
            activeHref={activeHref}
            header={{ href: "/", text: "Auto Insurance" }}
            onFollow={handleFollow}
            items={[
                { type: "link", text: "Dashboard", href: "/" },
                {
                    type: "section",
                    text: "Quotes",
                    items: [
                        { type: "link", text: "Form Quote", href: "/quote" },
                        { type: "link", text: "Chat with Assistant", href: "/chat-quote" },
                    ],
                },
                { type: "link", text: "My Profile", href: "/profile" },
                { type: "link", text: "Agent Traces", href: "/agent-traces" },
            ]}
        />
    );
}

export default Navigation;
