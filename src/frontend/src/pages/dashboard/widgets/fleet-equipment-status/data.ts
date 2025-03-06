// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { BarChartProps } from "@cloudscape-design/components/bar-chart";

const machinePlans = [
    {
        date: new Date(2024, 9, 16),
        "Operational Machines": 878,
        "Newly Purchased": 491,
        "Offline/Idle": 284,
        "Scheduled Maintenance": 70,
        "Unscheduled Maintenance": 70,
    },
    {
        date: new Date(2024, 10, 17),
        "Operational Machines": 781,
        "Newly Purchased": 435,
        "Offline/Idle": 242,
        "Scheduled Maintenance": 96,
        "Unscheduled Maintenance": 70,
    },
    {
        date: new Date(2024, 11, 18),
        "Operational Machines": 788,
        "Newly Purchased": 478,
        "Offline/Idle": 311,
        "Scheduled Maintenance": 79,
        "Unscheduled Maintenance": 70,
    },
    {
        date: new Date(2024, 12, 19),
        "Operational Machines": 729,
        "Newly Purchased": 558,
        "Offline/Idle": 298,
        "Scheduled Maintenance": 97,
        "Unscheduled Maintenance": 70,
    },
    {
        date: new Date(2025, 1, 1),
        "Operational Machines": 988,
        "Newly Purchased": 530,
        "Offline/Idle": 255,
        "Scheduled Maintenance": 97,
        "Unscheduled Maintenance": 70,
    },
    {
        date: new Date(2025, 2, 21),
        "Operational Machines": 1016,
        "Newly Purchased": 445,
        "Offline/Idle": 339,
        "Scheduled Maintenance": 70,
        "Unscheduled Maintenance": 70,
    },
    {
        date: new Date(2025, 3, 22),
        "Operational Machines": 987,
        "Newly Purchased": 549,
        "Offline/Idle": 273,
        "Scheduled Maintenance": 62,
        "Unscheduled Maintenance": 70,
    },
];

// Group data by month and aggregate values
const getMonthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;

const monthlyData = machinePlans.reduce(
    (acc, curr) => {
        const monthKey = getMonthKey(curr.date);

        if (!acc[monthKey]) {
            acc[monthKey] = {
                date: new Date(curr.date.getFullYear(), curr.date.getMonth(), 1),
                "Operational Machines": 0,
                "Newly Purchased": 0,
                "Offline/Idle": 0,
                "Scheduled Maintenance": 0,
                "Unscheduled Maintenance": 0,
            };
        }

        acc[monthKey]["Operational Machines"] += curr["Operational Machines"];
        acc[monthKey]["Newly Purchased"] += curr["Newly Purchased"];
        acc[monthKey]["Offline/Idle"] += curr["Offline/Idle"];
        acc[monthKey]["Scheduled Maintenance"] += curr["Scheduled Maintenance"];
        acc[monthKey]["Unscheduled Maintenance"] += curr["Unscheduled Maintenance"];

        return acc;
    },
    {} as Record<string, (typeof machinePlans)[0]>
);

// Convert back to array
const monthlyDataArray = Object.values(monthlyData);

// Format month for display
export const formatMonth = (date: Date) => {
    const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    ];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
};

// Export the month labels
export const months = monthlyDataArray.map(({ date }) => date);

// Create series with monthly data
export const series: BarChartProps<Date>["series"] = [
    {
        title: "Operational Machines",
        type: "bar",
        data: monthlyDataArray.map((datum) => ({
            x: datum.date,
            y: datum["Operational Machines"],
        })),
    },
    {
        title: "Newly Purchased",
        type: "bar",
        data: monthlyDataArray.map((datum) => ({ x: datum.date, y: datum["Newly Purchased"] })),
    },
    {
        title: "Offline/Idle",
        type: "bar",
        data: monthlyDataArray.map((datum) => ({ x: datum.date, y: datum["Offline/Idle"] })),
    },
    {
        title: "Scheduled Maintenance",
        type: "bar",
        data: monthlyDataArray.map((datum) => ({
            x: datum.date,
            y: datum["Scheduled Maintenance"],
        })),
    },
    {
        title: "Unscheduled Maintenance",
        type: "bar",
        data: monthlyDataArray.map((datum) => ({
            x: datum.date,
            y: datum["Unscheduled Maintenance"],
        })),
    },
];
