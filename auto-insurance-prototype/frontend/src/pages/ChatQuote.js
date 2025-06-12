import React, { useState, useEffect } from "react";
import {
    Container,
    Header,
    SpaceBetween,
    Button,
    Tabs,
    Box,
    TextContent,
    Grid,
} from "@cloudscape-design/components";
import ChatInterface from "../components/ChatInterface";
import AgentFlowVisualization from "../components/AgentFlowVisualization";
import AgentTraceList from "../components/AgentTrace";
import ExecutionTraceTimeline from "../components/ExecutionTraceTimeline";

const ChatQuote = ({ customerId = "cust-001" }) => {
    const [messages, setMessages] = useState([
        {
            role: "assistant",
            content: "Hello! I'm your auto insurance assistant. How can I help you today?",
        },
    ]);
    const [loading, setLoading] = useState(false);
    const [agentTraces, setAgentTraces] = useState([]);
    const [activeTabId, setActiveTabId] = useState("chat");
    const [quoteData, setQuoteData] = useState(null);

    const handleSendMessage = async (message) => {
        // Add user message to chat
        const updatedMessages = [...messages, { role: "user", content: message }];
        setMessages(updatedMessages);
        setLoading(true);

        try {
            // Send message to backend
            const response = await fetch("http://localhost:8000/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    customer_id: customerId,
                    messages: updatedMessages,
                }),
            });

            const data = await response.json();
            console.log("DEBUG - Chat response data:", data);

            // Check if a quote was generated
            if (data.quote) {
                console.log("DEBUG - Quote generated:", data.quote);
                setQuoteData(data.quote);

                // Add assistant response to chat with the quote
                setMessages([
                    ...updatedMessages,
                    {
                        role: "assistant",
                        content: data.response,
                        quote: data.quote,
                    },
                ]);
            } else {
                // Add assistant response to chat without a quote
                setMessages([
                    ...updatedMessages,
                    {
                        role: "assistant",
                        content: data.response,
                    },
                ]);
            }

            // Update agent traces if available
            if (data.agent_traces && data.agent_traces.length > 0) {
                console.log("DEBUG - Received agent traces:", data.agent_traces);
                setAgentTraces(data.agent_traces);
            } else {
                console.log("DEBUG - No agent traces in response");
            }
        } catch (error) {
            console.error("Error sending message:", error);
            setMessages([
                ...updatedMessages,
                {
                    role: "assistant",
                    content: "Sorry, there was an error processing your request. Please try again.",
                },
            ]);
        } finally {
            setLoading(false);
        }
    };

    // Poll for agent traces when a quote is being processed
    useEffect(() => {
        let interval;

        if (loading) {
            interval = setInterval(async () => {
                try {
                    console.log("DEBUG - Polling for agent traces");
                    const response = await fetch("http://localhost:8000/agent-traces");
                    const data = await response.json();
                    console.log("DEBUG - Agent traces poll response:", data);

                    if (data.traces && data.traces.length > 0) {
                        console.log("DEBUG - Updating agent traces from poll:", data.traces);
                        setAgentTraces(data.traces);
                    } else {
                        console.log("DEBUG - No traces in poll response");
                    }
                } catch (error) {
                    console.error("Error fetching agent traces:", error);
                }
            }, 2000); // Poll every 2 seconds
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [loading]);

    // When a quote is generated, switch to the visualization tab
    useEffect(() => {
        if (quoteData) {
            // Wait a moment to let the user read the quote in the chat
            setTimeout(() => {
                setActiveTabId("visualization");
            }, 2000);
        }
    }, [quoteData]);

    return (
        <Container>
            <SpaceBetween size="l">
                <Header
                    variant="h1"
                    description="Chat with our AI assistant to get a personalized auto insurance quote"
                >
                    Chat Quote
                </Header>

                <Tabs
                    activeTabId={activeTabId}
                    onChange={({ detail }) => setActiveTabId(detail.activeTabId)}
                    tabs={[
                        {
                            id: "chat",
                            label: "Chat",
                            content: (
                                <Box padding="l">
                                    <ChatInterface
                                        messages={messages}
                                        onSendMessage={handleSendMessage}
                                        loading={loading}
                                        agentTraces={agentTraces}
                                    />
                                </Box>
                            ),
                        },
                        {
                            id: "visualization",
                            label: "Agent Visualization",
                            content: (
                                <Box padding="l">
                                    <Grid gridDefinition={[{ colspan: { default: 12, xxs: 12 } }]}>
                                        <AgentFlowVisualization agentTraces={agentTraces} />
                                    </Grid>
                                </Box>
                            ),
                        },
                        {
                            id: "traces",
                            label: "Agent Traces",
                            content: (
                                <Box padding="l">
                                    <AgentTraceList traces={agentTraces} />
                                </Box>
                            ),
                        },
                        {
                            id: "timeline",
                            label: "Execution Timeline",
                            content: (
                                <Box padding="l">
                                    <ExecutionTraceTimeline traces={agentTraces} />
                                </Box>
                            ),
                        },
                    ]}
                />
            </SpaceBetween>
        </Container>
    );
};

export default ChatQuote;
