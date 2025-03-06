// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React from "react";

import BarChart from "@cloudscape-design/components/bar-chart";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";

import { barChartInstructions, commonChartProps } from "../chart-commons";
import { WidgetConfig } from "../interfaces";
import { months, series, formatMonth } from "./data";

function FleetEquipmentStatusHeader() {
    return (
        <Header
            variant="h2"
            description="The chart provides a monthly breakdown of the fleet's operation status, including active machines, new purchases, scheduled maintenance, unscheduled maintenance, and offline/idle equipment. It helps fleet managers track utilization trends and maintenance needs over time for better decision-making."
        >
            Fleet Equipment Status Overview
        </Header>
    );
}

function FleetEquipmentStatusContent() {
    return (
        <BarChart
            {...commonChartProps}
            fitHeight={true}
            height={25}
            yDomain={[0, 2000]}
            xDomain={months}
            xScaleType="categorical"
            stackedBars={true}
            hideFilter={true}
            series={series}
            xTitle="Month"
            yTitle="Number of Machines"
            ariaLabel="Instance hours"
            ariaDescription={`Bar chart showing total instance hours per instance type over the last 15 days. ${barChartInstructions}`}
            i18nStrings={{
                ...commonChartProps.i18nStrings,
                filterLabel: "Filter displayed instance types",
                filterPlaceholder: "Filter instance types",
                xTickFormatter: formatMonth,
            }}
            detailPopoverSeriesContent={({ series, y }) => ({
                key: series.title,
                value: (
                    <Link
                        external={true}
                        href="#"
                        ariaLabel={`See details for ${y} hours on ${series.title} (opens in a new tab)`}
                    >
                        {y}
                    </Link>
                ),
            })}
        />
    );
}
export const fleetEquipmentStatus: WidgetConfig = {
    definition: { defaultRowSpan: 4, defaultColumnSpan: 2, minRowSpan: 3 },
    data: {
        icon: "barChart",
        title: "Fleet Equipment Status Overview",
        description: "Daily instance hours by instance type",
        header: FleetEquipmentStatusHeader,
        content: FleetEquipmentStatusContent,
        staticMinHeight: 560,
    },
};
