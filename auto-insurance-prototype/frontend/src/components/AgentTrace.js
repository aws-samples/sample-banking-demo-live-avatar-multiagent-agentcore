import React from "react";
import {
    Box,
    Container,
    SpaceBetween,
    StatusIndicator,
    TextContent,
} from "@cloudscape-design/components";

const AgentTrace = ({ trace }) => {
    // Helper function to get status indicator type
    const getStatusIndicator = (status) => {
        switch (status) {
            case "started":
                return <StatusIndicator type="in-progress">Started</StatusIndicator>;
            case "completed":
                return <StatusIndicator type="success">Completed</StatusIndicator>;
            case "error":
                return <StatusIndicator type="error">Error</StatusIndicator>;
            default:
                return <StatusIndicator type="pending">Pending</StatusIndicator>;
        }
    };

    // Helper function to format agent name
    const formatAgentName = (agentId) => {
        return agentId
            .split("_")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
    };

    return (
        <Box padding="s" margin="s" variant="code" color="text-status-info" fontSize="body-s">
            <SpaceBetween direction="vertical" size="xs">
                <div>
                    <TextContent>
                        <h4>
                            {formatAgentName(trace.agentId)} {getStatusIndicator(trace.status)}
                        </h4>
                        <p>{new Date(trace.timestamp).toLocaleTimeString()}</p>
                    </TextContent>
                </div>

                {trace.input && (
                    <div>
                        <TextContent>
                            <strong>Input:</strong>
                        </TextContent>
                        <Box variant="code" padding="xs" fontSize="body-s">
                            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                                {JSON.stringify(trace.input, null, 2)}
                            </pre>
                        </Box>
                    </div>
                )}

                {trace.output && (
                    <div>
                        <TextContent>
                            <strong>Output:</strong>
                        </TextContent>
                        <Box variant="code" padding="xs" fontSize="body-s">
                            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                                {JSON.stringify(trace.output, null, 2)}
                            </pre>
                        </Box>
                    </div>
                )}

                {trace.reasoning && (
                    <div>
                        <TextContent>
                            <strong>Reasoning:</strong>
                            <p>{trace.reasoning}</p>
                        </TextContent>
                    </div>
                )}
            </SpaceBetween>
        </Box>
    );
};

const AgentTraceList = ({ traces }) => {
    if (!traces || traces.length === 0) {
        return (
            <Box textAlign="center" padding="m">
                <TextContent>
                    <p>No agent activity yet</p>
                </TextContent>
            </Box>
        );
    }

    return (
        <Container>
            <SpaceBetween direction="vertical" size="xs">
                {traces.map((trace, index) => (
                    <React.Fragment key={`${trace.agentId}-${trace.timestamp}-${index}`}>
                        <AgentTrace trace={trace} />
                        {index < traces.length - 1 && (
                            <Box padding="xxxs">
                                <hr
                                    style={{
                                        border: "none",
                                        borderTop: "1px solid #eaeded",
                                        margin: 0,
                                    }}
                                />
                            </Box>
                        )}
                    </React.Fragment>
                ))}
            </SpaceBetween>
        </Container>
    );
};

export default AgentTraceList;
