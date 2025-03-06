// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { LineChartProps } from "@cloudscape-design/components/line-chart";

const networkTrafficData = [
    { date: new Date(1600984800000), EngineCoolantTemperature: 67382, Average: 46560 },
    { date: new Date(1600985700000), EngineCoolantTemperature: 67382, Average: 49666 },
    { date: new Date(1600986600000), EngineCoolantTemperature: 74322, Average: 47996 },
    { date: new Date(1600987500000), EngineCoolantTemperature: 72499, Average: 46020 },
    { date: new Date(1600988400000), EngineCoolantTemperature: 69616, Average: 46568 },
    {
        date: new Date(1600989300000),
        EngineCoolantTemperature: 70055,
        Average: 47205,
    },
    {
        date: new Date(1600990200000),
        EngineCoolantTemperature: 74055,
        Average: 46329,
    },
    { date: new Date(1600991100000), EngineCoolantTemperature: 73420, Average: 49614 },
    { date: new Date(1600992000000), EngineCoolantTemperature: 65713, Average: 49792 },
    { date: new Date(1600992900000), EngineCoolantTemperature: 68954, Average: 48284 },
    { date: new Date(1600993800000), EngineCoolantTemperature: 74289, Average: 47697 },
    { date: new Date(1600994700000), EngineCoolantTemperature: 76521, Average: 46463 },
    { date: new Date(1600995600000), EngineCoolantTemperature: 78337, Average: 47384 },
    {
        date: new Date(1600996500000),
        EngineCoolantTemperature: 105029,
        Average: 47986,
    },
    {
        date: new Date(1600997400000),
        EngineCoolantTemperature: 104961,
        Average: 49529,
    },
    {
        date: new Date(1600998300000),
        EngineCoolantTemperature: 102044,
        Average: 48146,
    },
    {
        date: new Date(1600999200000),
        EngineCoolantTemperature: 120062,
        Average: 46001,
    },
    {
        date: new Date(1601000100000),
        EngineCoolantTemperature: 140112,
        Average: 46649,
    },
    {
        date: new Date(1601001000000),
        EngineCoolantTemperature: 138935,
        Average: 47895,
    },
    {
        date: new Date(1601001900000),
        EngineCoolantTemperature: 139103,
        Average: 47977,
    },
    {
        date: new Date(1601002800000),
        EngineCoolantTemperature: 132378,
        Average: 46908,
    },
    {
        date: new Date(1601003700000),
        EngineCoolantTemperature: 112884,
        Average: 46496,
    },
    {
        date: new Date(1601004600000),
        EngineCoolantTemperature: 74689,
        Average: 47991,
    },
    { date: new Date(1601005500000), EngineCoolantTemperature: 68451, Average: 48881 },
    { date: new Date(1601006400000), EngineCoolantTemperature: 66404, Average: 48833 },
    { date: new Date(1601007300000), EngineCoolantTemperature: 67037, Average: 46665 },
    { date: new Date(1601008200000), EngineCoolantTemperature: 70425, Average: 49552 },
    { date: new Date(1601009100000), EngineCoolantTemperature: 65583, Average: 49013 },
    { date: new Date(1601010000000), EngineCoolantTemperature: 67361, Average: 48834 },
    { date: new Date(1601010900000), EngineCoolantTemperature: 66421, Average: 49644 },
    { date: new Date(1601011800000), EngineCoolantTemperature: 69670, Average: 48032 },
    { date: new Date(1601012700000), EngineCoolantTemperature: 68534, Average: 49544 },
    { date: new Date(1601013600000), EngineCoolantTemperature: 71507, Average: 49043 },
];

export const networkTrafficDomain = [
    networkTrafficData[0].date,
    networkTrafficData[networkTrafficData.length - 1].date,
];

export const networkTrafficSeries: LineChartProps<Date>["series"] = [
    {
        title: "EngineCoolantTemperature",
        type: "line",
        valueFormatter: (value) => value.toLocaleString("en-US"),
        data: networkTrafficData.map((datum) => ({
            x: datum.date,
            y: datum["EngineCoolantTemperature"],
        })),
    },
    {
        title: "Average",
        type: "line",
        valueFormatter: (value) => value.toLocaleString("en-US"),
        data: networkTrafficData.map((datum) => ({ x: datum.date, y: datum["Average"] })),
    },
];
