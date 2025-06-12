import React, { useState, useRef, useEffect } from "react";
import {
    Container,
    SpaceBetween,
    Textarea,
    Button,
    Box,
    StatusIndicator,
    TextContent,
    Alert,
} from "@cloudscape-design/components";
import ReactMarkdown from "react-markdown";
import AgentTraceList from "./AgentTrace";

const ChatInterface = ({ messages, onSendMessage, loading, agentTraces = [] }) => {
    const [inputMessage, setInputMessage] = useState("");
    const messagesEndRef = useRef(null);

    // Scroll to bottom of messages
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = () => {
        if (inputMessage.trim() && !loading) {
            onSendMessage(inputMessage);
            setInputMessage("");
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    // Function to render quote information in a nice format
    const renderQuote = (quote) => {
        if (!quote) return null;

        return (
            <Box
                padding="m"
                variant="awsui-key-label"
                backgroundColor="background-container-content"
                borderRadius="default"
                margin="m"
            >
                <SpaceBetween size="s">
                    <TextContent>
                        <h3>Your Auto Insurance Quote</h3>
                        <p>
                            <strong>Quote ID:</strong> {quote.quote_id}
                        </p>
                        <p>
                            <strong>Vehicle:</strong> {quote.vehicle_info.year}{" "}
                            {quote.vehicle_info.make} {quote.vehicle_info.model}
                        </p>
                        <p>
                            <strong>Coverage:</strong>
                        </p>
                        <ul>
                            <li>Liability: {quote.coverage_details.liability}</li>
                            <li>
                                Collision:{" "}
                                {quote.coverage_details.collision ? "Included" : "Not included"}
                            </li>
                            <li>
                                Comprehensive:{" "}
                                {quote.coverage_details.comprehensive ? "Included" : "Not included"}
                            </li>
                            <li>Deductible: ${quote.coverage_details.deductible}</li>
                        </ul>
                        <p>
                            <strong>Premium:</strong> ${quote.premium}
                        </p>
                        {quote.discounts && quote.discounts.length > 0 && (
                            <>
                                <p>
                                    <strong>Discounts:</strong>
                                </p>
                                <ul>
                                    {quote.discounts.map((discount, idx) => (
                                        <li key={idx}>
                                            {discount.name}: ${discount.amount} (
                                            {discount.percentage}%)
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                        <p>
                            <strong>Total Premium:</strong> ${quote.total_premium}
                        </p>
                        <p>
                            <strong>Valid Until:</strong> {quote.valid_until}
                        </p>
                    </TextContent>
                    <Alert type="success">
                        Your quote has been generated successfully! You can proceed with this quote
                        or make changes to your coverage options.
                    </Alert>
                </SpaceBetween>
            </Box>
        );
    };

    return (
        <Container>
            <SpaceBetween size="l">
                <Box
                    padding="l"
                    style={{
                        height: "400px",
                        overflowY: "auto",
                        border: "1px solid #eaeded",
                        borderRadius: "4px",
                        backgroundColor: "#f8f8f8",
                    }}
                >
                    <SpaceBetween size="m">
                        {messages.map((message, index) => {
                            // Find any agent traces that should be displayed after this message
                            const relevantTraces = agentTraces.filter((trace, traceIndex) => {
                                // Show traces after assistant messages
                                return (
                                    message.role === "assistant" &&
                                    index === messages.length - 2 &&
                                    trace.status === "completed"
                                );
                            });

                            // Check if this message has a quote
                            const hasQuote = message.quote;

                            return (
                                <React.Fragment key={index}>
                                    <Box
                                        padding="m"
                                        style={{
                                            backgroundColor:
                                                message.role === "user" ? "#e1f5fe" : "#ffffff",
                                            borderRadius: "8px",
                                            alignSelf:
                                                message.role === "user" ? "flex-end" : "flex-start",
                                            maxWidth: "80%",
                                            marginLeft: message.role === "user" ? "auto" : "0",
                                            boxShadow: "0 1px 2px rgba(0, 0, 0, 0.1)",
                                        }}
                                    >
                                        <SpaceBetween size="xs">
                                            <TextContent>
                                                <strong>
                                                    {message.role === "user"
                                                        ? "You"
                                                        : "Insurance Assistant"}
                                                </strong>
                                                <ReactMarkdown>{message.content}</ReactMarkdown>
                                            </TextContent>
                                        </SpaceBetween>
                                    </Box>

                                    {hasQuote && renderQuote(message.quote)}

                                    {relevantTraces.length > 0 && (
                                        <Box>
                                            <AgentTraceList traces={relevantTraces} />
                                        </Box>
                                    )}
                                </React.Fragment>
                            );
                        })}
                        {loading && (
                            <Box padding="s">
                                <StatusIndicator type="loading">
                                    Assistant is typing...
                                </StatusIndicator>
                            </Box>
                        )}
                        <div ref={messagesEndRef} />
                    </SpaceBetween>
                </Box>

                <SpaceBetween size="s" direction="horizontal">
                    <Textarea
                        value={inputMessage}
                        onChange={({ detail }) => setInputMessage(detail.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Type your message here..."
                        rows={2}
                        style={{ flexGrow: 1 }}
                        disabled={loading}
                    />
                    <Button
                        variant="primary"
                        onClick={handleSend}
                        disabled={!inputMessage.trim() || loading}
                    >
                        Send
                    </Button>
                </SpaceBetween>
            </SpaceBetween>
        </Container>
    );
};

export default ChatInterface;
