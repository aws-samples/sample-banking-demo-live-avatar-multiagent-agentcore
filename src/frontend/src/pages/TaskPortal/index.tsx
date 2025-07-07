/* eslint-disable */
// @ts-nocheck

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    Badge,
    Box,
    Button,
    Container,
    ExpandableSection,
    Header,
    SpaceBetween,
    Spinner,
    Table,
    TextContent,
    ContentLayout,
} from "@cloudscape-design/components";
import Layout from "../../common/components/Layout";
import { Task, useTasks } from "../../hooks/useTasks";

export default function TaskPortal() {
    const navigate = useNavigate();
    const { data: tasks, isLoading, error } = useTasks();

    const getStatusBadge = (status: Task["status"]) => {
        const statusConfig = {
            "NOT_STARTED": { color: "grey" as const, text: "Not Started" },
            "IN_PROGRESS": { color: "blue" as const, text: "Running" },
            "COMPLETE": { color: "green" as const, text: "Complete" },
        };
        const config = statusConfig[status] || { color: "grey" as const, text: status };
        return (
            <Badge color={config.color}>
                {status === 'IN_PROGRESS' && <Spinner variant={'inverted'} />} {config.text}
            </Badge>
        );
    };

    const handleTaskClick = (taskId: string) => {
        navigate(`/task/${taskId}`);
    };

    return (
        <Layout
            content={
                <ContentLayout
                    header={
                        <Header variant="h1" description="Monitor and manage your tasks">
                            Task Portal
                        </Header>
                    }
                >
                    <Table
                        columnDefinitions={[
                            {
                                id: "status",
                                header: "Current Status",
                                cell: (item) => getStatusBadge(item.status),
                            },
                            {
                                id: "name",
                                header: "Name",
                                cell: (item) => (
                                    <Button
                                        variant="link"
                                        onClick={() => handleTaskClick(item.id)}
                                    >
                                        {item.name}
                                    </Button>
                                ),
                            },
                            {
                                id: "description",
                                header: "Description",
                                cell: (item) => item.description,
                            },
                            // {
                            //     id: "actions",
                            //     header: "Actions",
                            //     cell: (item) => {
                            //         if (item.status === "NOT_STARTED") {
                            //             return <Button variant="primary">Run</Button>;
                            //         } else if (item.status === "COMPLETE") {
                            //             return <Button variant="normal">Rerun</Button>;
                            //         }
                            //         return null;
                            //     },
                            // },
                        ]}
                        items={tasks || []}
                        loading={isLoading}
                        loadingText="Loading tasks"
                        trackBy={(item) => item.id}
                        variant="embedded"
                        wrapLines={true}
                        empty={
                            <Box textAlign="center" color="inherit">
                                <b>No tasks</b>
                                <Box padding={{ bottom: "s" }} variant="p" color="inherit">
                                    No tasks to display.
                                </Box>
                            </Box>
                        }
                    />
                </ContentLayout>
            }
        />
    );
}