// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React from "react";

import Header from "@cloudscape-design/components/header";
import LineChart from "@cloudscape-design/components/line-chart";
import Link from "@cloudscape-design/components/link";

import { commonChartProps, dateTimeFormatter } from "../chart-commons";
import { WidgetConfig } from "../interfaces";
import { networkTrafficDomain, networkTrafficSeries } from "./data";

function MetricTrendHeader() {
    return (
        <Header
            variant="h2"
            description="This line chart visualizes the historical trend of a selected metric, providing insights into its fluctuations over time. By monitoring these changes, fleet managers can identify patterns, anomalies, and potential maintenance needs, ensuring optimal equipment performance and efficiency."
        >
            Trend of Key Metric Over Time
        </Header>
    );
}

export default function MetricTrendContent() {
    return (
        <LineChart
            {...commonChartProps}
            hideFilter={true}
            fitHeight={true}
            height={25}
            series={networkTrafficSeries}
            yDomain={[0, 200000]}
            xDomain={networkTrafficDomain}
            xScaleType="time"
            xTitle="Time (UTC)"
            yTitle="Temperature"
            ariaLabel="Temperature"
            ariaDescription={`Line chart showing metric trends`}
            i18nStrings={{
                ...commonChartProps.i18nStrings,
                filterLabel: "Filter displayed instances",
                filterPlaceholder: "Filter instances",
                xTickFormatter: dateTimeFormatter,
            }}
            detailPopoverSeriesContent={({ series, y }) => ({
                key: (
                    <Link external={true} href="#">
                        {series.title}
                    </Link>
                ),
                value: y,
            })}
        />
    );
}
export const metricTrend: WidgetConfig = {
    definition: { defaultRowSpan: 4, defaultColumnSpan: 2, minRowSpan: 3 },
    data: {
        icon: "lineChart",
        title: "Trend of Key Metric Over Time",
        description:
            "This line chart visualizes the historical trend of a selected metric, providing insights into its fluctuations over time. By monitoring these changes, fleet managers can identify patterns, anomalies, and potential maintenance needs, ensuring optimal equipment performance and efficiency.",
        header: MetricTrendHeader,
        content: MetricTrendContent,
        staticMinHeight: 560,
    },
};
