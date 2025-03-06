// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React from "react";

import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";

import { WidgetConfig } from "../interfaces";

function FleetOverviewHeader() {
    return (
        <Header variant="h2" description={`Viewing fleet operations`}>
            Fleet Overview
        </Header>
    );
}

function FleetOverviewWidget() {
    return (
        <KeyValuePairs
            columns={4}
            items={[
                {
                    label: "Operational Machines",
                    value: (
                        <span style={{ color: "#00ff00" }}>
                            <Link
                                variant="awsui-value-large"
                                href="#"
                                ariaLabel="Running instances (14)"
                            >
                                14
                            </Link>
                        </span>
                    ),
                },
                {
                    label: "Idle Machines",
                    value: (
                        <Link variant="awsui-value-large" href="#" ariaLabel="Volumes (126)">
                            126
                        </Link>
                    ),
                },
                {
                    label: "Scheduled Maint",
                    value: (
                        <Link
                            variant="awsui-value-large"
                            href="#"
                            ariaLabel="Security groups (116)"
                        >
                            116
                        </Link>
                    ),
                },
                {
                    label: "Unscheduled Maint",
                    value: (
                        <Link variant="awsui-value-large" href="#" ariaLabel="Load balancers (28)">
                            28
                        </Link>
                    ),
                },
            ]}
        />
    );
}
export const fleetOverview: WidgetConfig = {
    definition: { defaultRowSpan: 2, defaultColumnSpan: 3 },
    data: {
        icon: "list",
        title: "Fleet Overview",
        description: "Fleet overview of all your machines",
        header: FleetOverviewHeader,
        content: FleetOverviewWidget,
    },
};
