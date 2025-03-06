// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React from "react";

import Grid from "@cloudscape-design/components/grid";

import {
    alarms,
    BaseStaticWidget,
    fleetEquipmentStatus,
    instanceLimits,
    metricTrend,
    serviceHealth,
    fleetOverview,
} from "../widgets";

export function Content() {
    return (
        <Grid
            gridDefinition={[
                { colspan: { l: 9, m: 9, default: 9 } },
                { colspan: { l: 3, m: 3, default: 3 } },
                { colspan: { l: 6, m: 6, default: 12 } },
                { colspan: { l: 6, m: 6, default: 12 } },
                { colspan: { l: 6, m: 6, default: 12 } },
                { colspan: { l: 6, m: 6, default: 12 } },
            ]}
        >
            {[
                fleetOverview,
                serviceHealth,
                fleetEquipmentStatus,
                metricTrend,
                alarms,
                instanceLimits,
            ].map((widget, index) => (
                <BaseStaticWidget key={index} config={widget.data} />
            ))}
        </Grid>
    );
}
