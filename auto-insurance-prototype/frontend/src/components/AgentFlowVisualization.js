import React, { useEffect, useRef } from "react";
import { Box, TextContent, SpaceBetween } from "@cloudscape-design/components";

const AgentFlowVisualization = ({ agentTraces }) => {
    const canvasRef = useRef(null);

    // Helper function to format agent name
    const formatAgentName = (agentId) => {
        return agentId
            .split("_")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
    };

    // Draw the agent flow visualization
    useEffect(() => {
        if (!canvasRef.current || !agentTraces || agentTraces.length === 0) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Sort traces by timestamp
        const sortedTraces = [...agentTraces].sort(
            (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
        );

        // Get unique agent IDs
        const agentIds = [...new Set(sortedTraces.map((trace) => trace.agentId))];

        // Define colors for different agents
        const colors = [
            "#16A085", // Green
            "#2980B9", // Blue
            "#8E44AD", // Purple
            "#C0392B", // Red
            "#D35400", // Orange
            "#2C3E50", // Dark Blue
        ];

        // Define the flow layout
        const margin = 50;
        const agentBoxWidth = 180;
        const agentBoxHeight = 60;
        const verticalSpacing = 100;
        const horizontalSpacing = 200;

        // Draw agent boxes
        const agentPositions = {};
        agentIds.forEach((agentId, index) => {
            const x = margin + (index % 3) * (agentBoxWidth + horizontalSpacing);
            const y = margin + Math.floor(index / 3) * (agentBoxHeight + verticalSpacing);

            // Store position for later use
            agentPositions[agentId] = { x, y };

            // Draw box
            ctx.fillStyle = colors[index % colors.length];
            ctx.fillRect(x, y, agentBoxWidth, agentBoxHeight);

            // Draw text
            ctx.fillStyle = "white";
            ctx.font = "14px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(formatAgentName(agentId), x + agentBoxWidth / 2, y + agentBoxHeight / 2);
        });

        // Draw connections between agents
        const connections = [];
        for (let i = 0; i < sortedTraces.length - 1; i++) {
            const currentAgent = sortedTraces[i].agentId;
            const nextAgent = sortedTraces[i + 1].agentId;

            if (currentAgent !== nextAgent) {
                connections.push({ from: currentAgent, to: nextAgent });
            }
        }

        // Draw arrows for connections
        connections.forEach((connection) => {
            const fromPos = agentPositions[connection.from];
            const toPos = agentPositions[connection.to];

            if (!fromPos || !toPos) return;

            // Draw arrow
            ctx.beginPath();
            ctx.moveTo(fromPos.x + agentBoxWidth, fromPos.y + agentBoxHeight / 2);
            
            // Create a curved path
            const controlX = (fromPos.x + agentBoxWidth + toPos.x) / 2;
            const controlY = (fromPos.y + toPos.y + agentBoxHeight / 2) / 2;
            
            ctx.quadraticCurveTo(
                controlX, 
                controlY, 
                toPos.x, 
                toPos.y + agentBoxHeight / 2
            );
            
            ctx.strokeStyle = "#7F8C8D";
            ctx.lineWidth = 2;
            ctx.stroke();

            // Draw arrowhead
            const arrowSize = 10;
            const angle = Math.atan2(
                toPos.y + agentBoxHeight / 2 - controlY,
                toPos.x - controlX
            );
            
            ctx.beginPath();
            ctx.moveTo(toPos.x, toPos.y + agentBoxHeight / 2);
            ctx.lineTo(
                toPos.x - arrowSize * Math.cos(angle - Math.PI / 6),
                toPos.y + agentBoxHeight / 2 - arrowSize * Math.sin(angle - Math.PI / 6)
            );
            ctx.lineTo(
                toPos.x - arrowSize * Math.cos(angle + Math.PI / 6),
                toPos.y + agentBoxHeight / 2 - arrowSize * Math.sin(angle + Math.PI / 6)
            );
            ctx.closePath();
            ctx.fillStyle = "#7F8C8D";
            ctx.fill();
        });

    }, [agentTraces]);

    if (!agentTraces || agentTraces.length === 0) {
        return (
            <Box textAlign="center" padding="m">
                <TextContent>
                    <p>No agent activity to visualize</p>
                </TextContent>
            </Box>
        );
    }

    return (
        <SpaceBetween size="l">
            <TextContent>
                <h2>Agent Flow Visualization</h2>
                <p>Visual representation of agent interactions during quote processing</p>
            </TextContent>
            
            <Box textAlign="center">
                <canvas 
                    ref={canvasRef} 
                    width={800} 
                    height={400} 
                    style={{ 
                        border: "1px solid #eaeded",
                        borderRadius: "5px",
                        maxWidth: "100%"
                    }} 
                />
            </Box>
            
            <Box>
                <TextContent>
                    <h3>Execution Summary</h3>
                    <p>
                        {agentTraces.length} agent operations executed in{" "}
                        {agentTraces.reduce((total, trace) => total + (trace.durationMs || 0), 0)}ms
                    </p>
                </TextContent>
            </Box>
        </SpaceBetween>
    );
};

export default AgentFlowVisualization;
