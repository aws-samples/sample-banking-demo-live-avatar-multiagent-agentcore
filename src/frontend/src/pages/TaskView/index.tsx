/* eslint-disable */
// @ts-nocheck

import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import {
    Box,
    BreadcrumbGroup,
    Button,
    ColumnLayout,
    Container,
    Header,
    SpaceBetween,
    StatusIndicator,
    TextContent,
    Tabs,
    ContentLayout,
    Spinner
} from "@cloudscape-design/components";
import Layout from "../../common/components/Layout";
import WorkflowView from "../WorkflowView";
import OutputGrid from "./OutputGrid";
import { Task, useTask } from "../../hooks/useTasks";
import { useTaskOutput } from "../../hooks/useStorage";


export default function TaskView() {
    const { taskId } = useParams<{ taskId: string }>();
    const navigate = useNavigate();
    const { data: task, isLoading } = useTask(taskId || '');
    const { data: taskOutput, isOutputLoading } = useTaskOutput(task?.workflow || '');
    const [activeTabId, setActiveTabId] = useState("output");
    const [taskStatus, setTaskStatus] = useState(task?.status);

    useEffect(() => {
        console.log('TASK', task)
        console.log('TASK OUT', taskOutput)
        console.log('taskStatus', taskStatus)
        setTaskStatus(task?.status)

    }, [task, taskOutput]);

    const wait = (ms: number) => {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    if (isLoading) {
        return (
            <Layout
                content={
                    <Container>
                        <Box textAlign="center">
                            <Spinner size="large" />
                        </Box>
                    </Container>
                }
            />
        );
    }

    if (!task) {
        return (
            <Layout
                content={
                    <Container>
                        <Box textAlign="center">
                            <StatusIndicator type="error">Task not found</StatusIndicator>
                        </Box>
                    </Container>
                }
            />
        );
    }

    const getStatusIndicator = (status: Task["status"]) => {
        const statusConfig = {
            "NOT_STARTED": { type: "pending" as const, text: "Not Started" },
            "IN_PROGRESS": { type: "in-progress" as const, text: "Running" },
            "COMPLETE": { type: "success" as const, text: "Complete" },
        };
        const config = statusConfig[status];
        return <StatusIndicator type={config.type}>{config.text}</StatusIndicator>;
    };

    return (
        <Layout
            breadcrumbs={
                <BreadcrumbGroup
                    items={[
                        { text: "Task Portal", href: "/tasks" },
                        { text: "Task", href: "#" },
                    ]}
                />
            }
            content={
                <ContentLayout>
                <SpaceBetween size="l">
                    <Container
                        header={
                            <Header
                                variant="h2"
                                description={task.description}
                                actions={
                                    // <Button onClick={() => navigate("/tasks")}>
                                    //     Back to Tasks
                                    // </Button>
                                    <div>
                                        {/*<Box variant="awsui-key-label">Status</Box>*/}
                                        <div>{getStatusIndicator(taskStatus || task.status)}</div>
                                    </div>
                                }
                            >
                                {task.name}
                            </Header>
                        }
                    >


                    <Tabs
                        activeTabId={activeTabId}
                        onChange={({ detail }) => {
                            setActiveTabId(detail.activeTabId)
                            if(detail.activeTabId === 'output') {
                                setTaskStatus("COMPLETE")
                            }
                        }}
                        tabs={[
                            {
                                id: "output",
                                label: "Output",
                                content: <Container variant={'inline'} header={<Header variant="h2">Final Output</Header>}>
                                    {
                                        taskStatus === "COMPLETE" ?
                                        <OutputGrid data={taskOutput} />
                                        :
                                            (
                                                !taskStatus || isOutputLoading ?
                                                <Box>Loading...</Box>
                                                :
                                                <SpaceBetween size={'s'} direction={'vertical'}>
                                                    <StatusIndicator type="in-progress">Awaiting task completion</StatusIndicator>
                                                    <Button onClick={() => setActiveTabId('workflow')}>See live workflow</Button>
                                                </SpaceBetween>
                                            )

                                    }
                                </Container>
                            },
                            {
                                id: "workflow",
                                label: "Workflow View",
                                content: <WorkflowView workflow={task.workflow} status={taskStatus || task.status} />
                            }
                        ]}
                    />
                    </Container>
                </SpaceBetween>
                </ContentLayout>
            }
        />
    );
}