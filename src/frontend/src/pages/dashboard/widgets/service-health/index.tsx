// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React from "react";

import Box from "@cloudscape-design/components/box";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Header from "@cloudscape-design/components/header";
import StatusIndicator from "@cloudscape-design/components/status-indicator";

import { InfoLink, useHelpPanel } from "../../../commons";
import { WidgetConfig } from "../interfaces";
import { ServiceHealthInfo } from "./help-content";

function ServiceHealthHeader() {
    const loadHelpPanelContent = useHelpPanel();
    return (
        <Header
            variant="h2"
            info={
                <InfoLink
                    data-testid="service-health-info-link"
                    onFollow={() => loadHelpPanelContent(<ServiceHealthInfo />)}
                />
            }
        >
            Purchase & Retirement
        </Header>
    );
}

export default function ServiceHealthContent() {
    return (
        <ColumnLayout columns={2}>
            <div>
                <Box variant="awsui-key-label">Purchase Plan for This Year</Box>
                <StatusIndicator type="success">3 purchased in Jan 2025</StatusIndicator>
            </div>
            <div>
                <Box variant="awsui-key-label">Upcoming Retirement Plan</Box>
                <StatusIndicator type="pending">2 plan to retire in Aug 2025</StatusIndicator>
            </div>
        </ColumnLayout>
    );
}
export const serviceHealth: WidgetConfig = {
    definition: { defaultRowSpan: 2, defaultColumnSpan: 1 },
    data: {
        icon: "list",
        title: "Purchase & Retirement",
        description: "General information about purchase plans and upcoming retirements",
        header: ServiceHealthHeader,
        content: ServiceHealthContent,
    },
};
