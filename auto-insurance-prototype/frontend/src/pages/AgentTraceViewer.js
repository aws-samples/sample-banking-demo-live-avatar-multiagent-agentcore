import React, { useState, useEffect } from "react";
import {
    Container,
    Header,
    SpaceBetween,
    Button,
    Table,
    Box,
    TextContent,
    Tabs,
    StatusIndicator,
    ColumnLayout,
    Badge,
    Spinner,
    Cards,
    CollectionPreferences,
    Pagination,
} from "@cloudscape-design/components";
import AgentTraceList from "../components/AgentTrace";

const AgentTraceViewer = () => {
    const [traces, setTraces] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshInterval, setRefreshInterval] = useState(5000); // 5 seconds
    const [activeTabId, setActiveTabId] = useState("list");
    const [preferences, setPreferences] = useState({
        pageSize: 10,
        visibleContent: ["timestamp", "agentId", "status", "duration"],
    });
    const [currentPageIndex, setCurrentPageIndex] = useState(1);

    // Fetch traces from the backend
    const fetchTraces = async () => {
        try {
            const response = await fetch("http://localhost:8000/agent-traces");
            const data = await response.json();
            
            if (data.traces && Array.isArray(data.traces)) {
                console.log(`Fetched ${data.traces.length} traces`);
                setTraces(data.traces);
            } else {
                console.warn("No traces found or invalid format");
                setTraces([]);
            }
        } catch (error) {
            console.error("Error fetching traces:", error);
        } finally {
            setLoading(false);
        }
    };

    // Initial fetch and setup refresh interval
    useEffect(() => {
        fetchTraces();
        
        const interval = setInterval(() => {
            fetchTraces();
        }, refreshInterval);
        
        return () => clearInterval(interval);
    }, [refreshInterval]);

    // Helper function to get status indicator
    const getStatusIndicator = (status) => {
        switch (status) {
            case "completed":
                return <StatusIndicator type="success">Completed</StatusIndicator>;
            case "error":
                return <StatusIndicator type="error">Error</StatusIndicator>;
            case "started":
                return <StatusIndicator type="in-progress">Started</StatusIndicator>;
            default:
                return <StatusIndicator type="pending">Unknown</StatusIndicator>;
        }
    };

    // Format agent name for display
    const formatAgentName = (agentId) => {
        return agentId
            .split("_")
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
    };

    // Table columns definition
    const tableColumns = [
        {
            id: "timestamp",
            header: "Timestamp",
            cell: item => new Date(item.timestamp).toLocaleString(),
            sortingField: "timestamp",
        },
        {
            id: "agentId",
            header: "Agent",
            cell: item => formatAgentName(item.agentId),
            sortingField: "agentId",
        },
        {
            id: "status",
            header: "Status",
            cell: item => getStatusIndicator(item.status),
            sortingField: "status",
        },
        {
            id: "duration",
            header: "Duration",
            cell: item => item.durationMs ? `${item.durationMs}ms` : "-",
            sortingField: "durationMs",
        },
        {
            id: "input",
            header: "Input",
            cell: item => (
                <Box maxHeight="100px" overflow="auto">
                    <pre style={{ margin: 0, fontSize: "12px" }}>
                        {JSON.stringify(item.input, null, 2)}
                    </pre>
                </Box>
            ),
        },
        {
            id: "output",
            header: "Output",
            cell: item => (
                <Box maxHeight="100px" overflow="auto">
                    <pre style={{ margin: 0, fontSize: "12px" }}>
                        {JSON.stringify(item.output, null, 2)}
                    </pre>
                </Box>
            ),
        },
    ];

    // Calculate visible items based on pagination
    const visibleItems = traces.slice(
        (currentPageIndex - 1) * preferences.pageSize,
        currentPageIndex * preferences.pageSize
    );

    // Card definition for card view
    const cardDefinition = {
        header: item => formatAgentName(item.agentId),
        sections: [
            {
                id: "status",
                header: "Status",
                content: item => getStatusIndicator(item.status),
            },
            {
                id: "timestamp",
                header: "Timestamp",
                content: item => new Date(item.timestamp).toLocaleString(),
            },
            {
                id: "duration",
                header: "Duration",
                content: item => item.durationMs ? `${item.durationMs}ms` : "-",
            },
            {
                id: "details",
                header: "Details",
                content: item => (
                    <SpaceBetween size="s">
                        {item.input && (
                            <Box>
                                <TextContent>
                                    <h5>Input:</h5>
                                </TextContent>
                                <Box variant="code" padding="xs">
                                    <pre style={{ margin: 0, fontSize: "12px" }}>
                                        {JSON.stringify(item.input, null, 2)}
                                    </pre>
                                </Box>
                            </Box>
                        )}
                        {item.output && (
                            <Box>
                                <TextContent>
                                    <h5>Output:</h5>
                                </TextContent>
                                <Box variant="code" padding="xs">
                                    <pre style={{ margin: 0, fontSize: "12px" }}>
                                        {JSON.stringify(item.output, null, 2)}
                                    </pre>
                                </Box>
                            </Box>
                        )}
                        {item.reasoning && (
                            <Box>
                                <TextContent>
                                    <h5>Reasoning:</h5>
                                    <p>{item.reasoning}</p>
                                </TextContent>
                            </Box>
                        )}
                    </SpaceBetween>
                ),
            },
        ],
    };

    // Timeline view component
    const TimelineView = () => {
        return (
            <Box padding="m">
                <SpaceBetween size="l">
                    {traces.map((trace, index) => (
                        <Box 
                            key={`${trace.agentId}-${trace.timestamp}-${index}`}
                            padding="s"
                            variant={trace.status === "error" ? "error" : "default"}
                        >
                            <ColumnLayout columns={3}>
                                <div>
                                    <TextContent>
                                        <h4>{formatAgentName(trace.agentId)}</h4>
                                        <p>{new Date(trace.timestamp).toLocaleString()}</p>
                                    </TextContent>
                                </div>
                                <div>
                                    {getStatusIndicator(trace.status)}
                                    {trace.durationMs && (
                                        <Badge color="blue">{trace.durationMs}ms</Badge>
                                    )}
                                </div>
                                <div>
                                    {trace.reasoning && (
                                        <TextContent>
                                            <p>{trace.reasoning}</p>
                                        </TextContent>
                                    )}
                                </div>
                            </ColumnLayout>
                        </Box>
                    ))}
                </SpaceBetween>
            </Box>
        );
    };

    return (
        <Container>
            <SpaceBetween size="l">
                <Header
                    variant="h1"
                    description="View detailed traces of agent activity in the system"
                    actions={
                        <Button onClick={fetchTraces} iconName="refresh">
                            Refresh
                        </Button>
                    }
                >
                    Agent Trace Viewer
                </Header>

                {loading ? (
                    <Box textAlign="center" padding="l">
                        <Spinner size="large" />
                        <TextContent>
                            <p>Loading agent traces...</p>
                        </TextContent>
                    </Box>
                ) : (
                    <Tabs
                        activeTabId={activeTabId}
                        onChange={({ detail }) => setActiveTabId(detail.activeTabId)}
                        tabs={[
                            {
                                id: "list",
                                label: "List View",
                                content: (
                                    <Box padding="l">
                                        <AgentTraceList traces={traces} />
                                    </Box>
                                ),
                            },
                            {
                                id: "table",
                                label: "Table View",
                                content: (
                                    <Table
                                        columnDefinitions={tableColumns}
                                        items={visibleItems}
                                        loading={loading}
                                        loadingText="Loading traces"
                                        empty={
                                            <Box textAlign="center" padding="m">
                                                <TextContent>
                                                    <p>No agent traces available</p>
                                                </TextContent>
                                            </Box>
                                        }
                                        header={
                                            <Header
                                                counter={`(${traces.length})`}
                                                actions={
                                                    <SpaceBetween direction="horizontal" size="xs">
                                                        <Button onClick={fetchTraces} iconName="refresh">
                                                            Refresh
                                                        </Button>
                                                    </SpaceBetween>
                                                }
                                            >
                                                Agent Traces
                                            </Header>
                                        }
                                        pagination={
                                            <Pagination
                                                currentPageIndex={currentPageIndex}
                                                onChange={({ detail }) => setCurrentPageIndex(detail.currentPageIndex)}
                                                pagesCount={Math.ceil(traces.length / preferences.pageSize)}
                                            />
                                        }
                                        preferences={
                                            <CollectionPreferences
                                                title="Preferences"
                                                confirmLabel="Confirm"
                                                cancelLabel="Cancel"
                                                preferences={preferences}
                                                onConfirm={({ detail }) => setPreferences(detail)}
                                                pageSizePreference={{
                                                    title: "Page size",
                                                    options: [
                                                        { value: 10, label: "10 traces" },
                                                        { value: 20, label: "20 traces" },
                                                        { value: 50, label: "50 traces" },
                                                    ],
                                                }}
                                                visibleContentPreference={{
                                                    title: "Select visible columns",
                                                    options: [
                                                        {
                                                            label: "Trace properties",
                                                            options: [
                                                                { id: "timestamp", label: "Timestamp" },
                                                                { id: "agentId", label: "Agent" },
                                                                { id: "status", label: "Status" },
                                                                { id: "duration", label: "Duration" },
                                                                { id: "input", label: "Input" },
                                                                { id: "output", label: "Output" },
                                                            ],
                                                        },
                                                    ],
                                                }}
                                            />
                                        }
                                    />
                                ),
                            },
                            {
                                id: "cards",
                                label: "Card View",
                                content: (
                                    <Cards
                                        cardDefinition={cardDefinition}
                                        cardsPerRow={[{ cards: 1 }, { minWidth: 500, cards: 2 }]}
                                        items={visibleItems}
                                        loading={loading}
                                        loadingText="Loading traces"
                                        empty={
                                            <Box textAlign="center" padding="m">
                                                <TextContent>
                                                    <p>No agent traces available</p>
                                                </TextContent>
                                            </Box>
                                        }
                                        header={
                                            <Header
                                                counter={`(${traces.length})`}
                                                actions={
                                                    <Button onClick={fetchTraces} iconName="refresh">
                                                        Refresh
                                                    </Button>
                                                }
                                            >
                                                Agent Traces
                                            </Header>
                                        }
                                        pagination={
                                            <Pagination
                                                currentPageIndex={currentPageIndex}
                                                onChange={({ detail }) => setCurrentPageIndex(detail.currentPageIndex)}
                                                pagesCount={Math.ceil(traces.length / preferences.pageSize)}
                                            />
                                        }
                                    />
                                ),
                            },
                            {
                                id: "timeline",
                                label: "Timeline View",
                                content: <TimelineView />,
                            },
                        ]}
                    />
                )}
            </SpaceBetween>
        </Container>
    );
};

export default AgentTraceViewer;
