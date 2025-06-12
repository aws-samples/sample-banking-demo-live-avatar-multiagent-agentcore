import React from "react";
import {
    Box,
    SpaceBetween,
    StatusIndicator,
    TextContent,
    ColumnLayout,
    Badge,
} from "@cloudscape-design/components";

const ExecutionTraceTimeline = ({ traces }) => {
    if (!traces || traces.length === 0) {
        return (
            <Box textAlign="center" padding="m">
                <TextContent>
                    <p>No execution traces available</p>
                </TextContent>
            </Box>
        );
    }

    // Sort traces by timestamp
    const sortedTraces = [...traces].sort(
        (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );

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

    // Calculate total execution time
    const totalExecutionTime = sortedTraces.reduce(
        (total, trace) => total + (trace.durationMs || 0), 
        0
    );

    // Calculate start and end times
    const startTime = new Date(sortedTraces[0].timestamp);
    const endTime = sortedTraces.length > 1 ? 
        new Date(sortedTraces[sortedTraces.length - 1].timestamp) : 
        new Date(startTime.getTime() + totalExecutionTime);

    return (
        <Box padding="m">
            <SpaceBetween size="l">
                <TextContent>
                    <h2>Execution Timeline</h2>
                    <p>
                        Total execution time: {totalExecutionTime}ms
                        <br />
                        Started: {startTime.toLocaleString()}
                        <br />
                        Completed: {endTime.toLocaleString()}
                    </p>
                </TextContent>

                <Box>
                    {sortedTraces.map((trace, index) => {
                        // Calculate the relative position in the timeline
                        const traceTime = new Date(trace.timestamp);
                        const timeFromStart = traceTime - startTime;
                        const totalDuration = endTime - startTime;
                        const position = Math.min(Math.max((timeFromStart / totalDuration) * 100, 0), 100);

                        return (
                            <Box 
                                key={`${trace.agentId}-${trace.timestamp}-${index}`}
                                padding="s"
                                variant={trace.status === "error" ? "error" : "default"}
                                style={{ 
                                    marginLeft: `${position}%`, 
                                    marginBottom: "10px",
                                    borderLeft: "3px solid #16A085",
                                    maxWidth: "80%"
                                }}
                            >
                                <ColumnLayout columns={3}>
                                    <div>
                                        <TextContent>
                                            <h4>{formatAgentName(trace.agentId)}</h4>
                                            <p>{new Date(trace.timestamp).toLocaleTimeString()}</p>
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
                        );
                    })}
                </Box>
            </SpaceBetween>
        </Box>
    );
};

export default ExecutionTraceTimeline;
