// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React from "react";

import Header from "@cloudscape-design/components/header";
import HelpPanel from "@cloudscape-design/components/help-panel";

import { ExternalLinkGroup, InfoLink, useHelpPanel } from "../../commons";

export function DashboardMainInfo() {
    return (
        <HelpPanel
            header={<h2>Smart Machines</h2>}
            footer={
                <ExternalLinkGroup
                    items={[
                        { href: "#", text: "Link 1" },
                        { href: "#", text: "Link 2" },
                    ]}
                />
            }
        >
            <p>Smart Machines Dasbhoard. Description goes here</p>
        </HelpPanel>
    );
}

export function DashboardHeader({ actions }: { actions: React.ReactNode }) {
    const loadHelpPanelContent = useHelpPanel();
    return (
        <Header
            variant="h1"
            info={<InfoLink onFollow={() => loadHelpPanelContent(<DashboardMainInfo />)} />}
            actions={actions}
        >
            Equipment Maintenance Dashboard
        </Header>
    );
}

export function DashboardHeaderNoActions() {
    const loadHelpPanelContent = useHelpPanel();
    return (
        <Header
            variant="h1"
            info={<InfoLink onFollow={() => loadHelpPanelContent(<DashboardMainInfo />)} />}
        >
            Equipment Maintenance Dashboard
        </Header>
    );
}
