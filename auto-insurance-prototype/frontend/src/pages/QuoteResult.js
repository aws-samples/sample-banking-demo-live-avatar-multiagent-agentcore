import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
    Box,
    Button,
    ColumnLayout,
    Container,
    Header,
    SpaceBetween,
    Table,
    TextContent,
    Alert,
    ExpandableSection,
    Badge,
    StatusIndicator,
} from "@cloudscape-design/components";

function QuoteResult() {
    const navigate = useNavigate();
    const [quoteResult, setQuoteResult] = useState(null);
    const [processingMetadata, setProcessingMetadata] = useState(null);

    useEffect(() => {
        // Retrieve the quote result from sessionStorage
        const storedQuote = sessionStorage.getItem("quoteResult");
        const storedMetadata = sessionStorage.getItem("processingMetadata");

        if (storedQuote) {
            setQuoteResult(JSON.parse(storedQuote));
        } else {
            // If no quote result is found, redirect to the quote form
            navigate("/quote");
        }

        if (storedMetadata) {
            setProcessingMetadata(JSON.parse(storedMetadata));
        }
    }, [navigate]);

    const handleNewQuote = () => {
        navigate("/quote");
    };

    if (!quoteResult) {
        return <div>Loading quote result...</div>;
    }

    // Format the risk level for display
    const getRiskBadge = (riskLevel) => {
        const colorMap = {
            low: "green",
            moderate: "blue", 
            high: "red"
        };
        return <Badge color={colorMap[riskLevel] || "grey"}>{riskLevel?.toUpperCase()}</Badge>;
    };

    return (
        <Container>
            <SpaceBetween size="l">
                <Alert type="success">
                    Your quote has been successfully generated using our advanced multi-agent system!
                    {processingMetadata && (
                        <Box padding={{ top: "s" }}>
                            <small>
                                Processing completed in {processingMetadata.total_processing_time?.toFixed(3)}s
                            </small>
                        </Box>
                    )}
                </Alert>

                <Header
                    variant="h1"
                    actions={
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button onClick={handleNewQuote}>Get Another Quote</Button>
                            <Button variant="primary">Purchase Policy</Button>
                        </SpaceBetween>
                    }
                >
                    Your Auto Insurance Quote
                </Header>

                <Box padding="l" bgcolor="light">
                    <ColumnLayout columns={2} variant="text-grid">
                        <SpaceBetween size="l">
                            <TextContent>
                                <h3>Quote Summary</h3>
                                <p>
                                    <strong>Quote ID:</strong> {quoteResult.quote_id}
                                </p>
                                <p>
                                    <strong>Valid Until:</strong> {new Date(quoteResult.valid_until).toLocaleDateString()}
                                </p>
                                <p>
                                    <strong>Annual Premium:</strong> $
                                    {quoteResult.premium.amount.toLocaleString()}/year
                                </p>
                                <p>
                                    <strong>Risk Level:</strong> {getRiskBadge(quoteResult.risk_factors.overall_risk)}
                                </p>
                            </TextContent>
                        </SpaceBetween>

                        <SpaceBetween size="l">
                            <TextContent>
                                <h3>Vehicle Information</h3>
                                <p>
                                    <strong>Vehicle:</strong> {quoteResult.vehicle.year} {quoteResult.vehicle.make} {quoteResult.vehicle.model}
                                </p>
                                <p>
                                    <strong>Estimated Value:</strong> $
                                    {quoteResult.vehicle.value.toLocaleString()}
                                </p>
                                <p>
                                    <strong>Customer:</strong> {quoteResult.customer.name}
                                </p>
                                <p>
                                    <strong>Age:</strong> {quoteResult.risk_factors.age} years
                                </p>
                            </TextContent>
                        </SpaceBetween>
                    </ColumnLayout>
                </Box>

                <ExpandableSection headerText="Recommended Coverage Details">
                    <Alert type="info">
                        <strong>Coverage Recommendation:</strong> {quoteResult.coverage.product.name}
                        <Box padding={{ top: "s" }}>
                            {quoteResult.coverage.reasoning}
                        </Box>
                    </Alert>
                    
                    <Box padding={{ top: "m" }}>
                        <ColumnLayout columns={2} variant="text-grid">
                            <SpaceBetween size="l">
                                <TextContent>
                                    <h3>Liability Coverage</h3>
                                    <p>
                                        <strong>Coverage Options:</strong> {quoteResult.coverage.product.coverage_options.liability.join(", ")}
                                    </p>
                                    <p>
                                        <strong>Uninsured Motorist:</strong>{" "}
                                        <StatusIndicator type={quoteResult.coverage.product.coverage_options.uninsured_motorist ? "success" : "stopped"}>
                                            {quoteResult.coverage.product.coverage_options.uninsured_motorist ? "Included" : "Not Included"}
                                        </StatusIndicator>
                                    </p>
                                    <p>
                                        <strong>Medical Payments:</strong> {quoteResult.coverage.product.coverage_options.medical_payments.join(" or ")}
                                    </p>
                                </TextContent>
                            </SpaceBetween>

                            <SpaceBetween size="l">
                                <TextContent>
                                    <h3>Vehicle Coverage</h3>
                                    <p>
                                        <strong>Collision:</strong>{" "}
                                        <StatusIndicator type={quoteResult.coverage.product.coverage_options.collision ? "success" : "stopped"}>
                                            {quoteResult.coverage.product.coverage_options.collision ? "Included" : "Not Included"}
                                        </StatusIndicator>
                                    </p>
                                    <p>
                                        <strong>Comprehensive:</strong>{" "}
                                        <StatusIndicator type={quoteResult.coverage.product.coverage_options.comprehensive ? "success" : "stopped"}>
                                            {quoteResult.coverage.product.coverage_options.comprehensive ? "Included" : "Not Included"}
                                        </StatusIndicator>
                                    </p>
                                    {quoteResult.coverage.product.coverage_options.rental_reimbursement && (
                                        <p>
                                            <strong>Rental Reimbursement:</strong>{" "}
                                            <StatusIndicator type="success">Included</StatusIndicator>
                                        </p>
                                    )}
                                    {quoteResult.coverage.product.coverage_options.roadside_assistance && (
                                        <p>
                                            <strong>Roadside Assistance:</strong>{" "}
                                            <StatusIndicator type="success">Included</StatusIndicator>
                                        </p>
                                    )}
                                </TextContent>
                            </SpaceBetween>
                        </ColumnLayout>
                    </Box>
                </ExpandableSection>

                <ExpandableSection headerText="Risk Assessment Details">
                    <ColumnLayout columns={2} variant="text-grid">
                        <SpaceBetween size="l">
                            <TextContent>
                                <h3>Driver Risk Factors</h3>
                                <p>
                                    <strong>Age Factor:</strong> {quoteResult.risk_factors.age_factor}x
                                </p>
                                <p>
                                    <strong>Driving History Factor:</strong> {quoteResult.risk_factors.history_factor}x
                                </p>
                                <p>
                                    <strong>Credit Risk:</strong> {getRiskBadge(quoteResult.risk_factors.credit_risk)}
                                </p>
                                <p>
                                    <strong>Credit Factor:</strong> {quoteResult.risk_factors.credit_factor}x
                                </p>
                            </TextContent>
                        </SpaceBetween>

                        <SpaceBetween size="l">
                            <TextContent>
                                <h3>Driving History</h3>
                                <p>
                                    <strong>Accidents:</strong> {quoteResult.risk_factors.accidents}
                                </p>
                                <p>
                                    <strong>Violations:</strong> {quoteResult.risk_factors.violations}
                                </p>
                                <p>
                                    <strong>Vehicle Factor:</strong> {quoteResult.risk_factors.vehicle_factor}x
                                </p>
                                <p>
                                    <strong>Overall Risk:</strong> {getRiskBadge(quoteResult.risk_factors.overall_risk)}
                                </p>
                            </TextContent>
                        </SpaceBetween>
                    </ColumnLayout>
                </ExpandableSection>

                <Header variant="h2">Premium Breakdown</Header>
                <Table
                    columnDefinitions={[
                        {
                            id: "description",
                            header: "Description",
                            cell: (item) => item.description,
                        },
                        {
                            id: "amount",
                            header: "Amount",
                            cell: (item) => item.amount,
                        },
                    ]}
                    items={[
                        {
                            description: "Base Premium",
                            amount: `$${quoteResult.premium.breakdown.base_premium.toLocaleString()}`,
                        },
                        {
                            description: "Risk Multiplier",
                            amount: `${quoteResult.premium.breakdown.risk_multiplier}x`,
                        },
                        {
                            description: "Vehicle Factor",
                            amount: `${quoteResult.premium.breakdown.vehicle_factor}x`,
                        },
                        ...quoteResult.premium.breakdown.discounts.map((discount) => ({
                            description: `${discount.name.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())} Discount (${(discount.percentage * 100).toFixed(0)}% off)`,
                            amount: `-$${(quoteResult.premium.breakdown.base_premium * quoteResult.premium.breakdown.risk_multiplier * quoteResult.premium.breakdown.vehicle_factor * discount.percentage).toFixed(2)}`,
                        })),
                        {
                            description: "Total Annual Premium",
                            amount: `$${quoteResult.premium.amount.toLocaleString()}`,
                        },
                    ]}
                />

                {processingMetadata && (
                    <ExpandableSection headerText="Processing Details">
                        <Table
                            columnDefinitions={[
                                {
                                    id: "agent",
                                    header: "Agent",
                                    cell: (item) => item.agent,
                                },
                                {
                                    id: "time",
                                    header: "Processing Time",
                                    cell: (item) => item.time,
                                },
                                {
                                    id: "source",
                                    header: "Data Source",
                                    cell: (item) => item.source,
                                },
                            ]}
                            items={[
                                {
                                    agent: "Customer Information",
                                    time: `${(processingMetadata.customer_info_processing_time * 1000).toFixed(0)}ms`,
                                    source: processingMetadata.customer_info_source === "mcp" ? "MCP Server" : "Local Fallback",
                                },
                                {
                                    agent: "Vehicle Information", 
                                    time: `${(processingMetadata.vehicle_info_processing_time * 1000).toFixed(0)}ms`,
                                    source: processingMetadata.vehicle_info_source === "mcp" ? "MCP Server" : "Local Fallback",
                                },
                                {
                                    agent: "Risk Assessment",
                                    time: `${(processingMetadata.risk_assessment_processing_time * 1000).toFixed(0)}ms`,
                                    source: processingMetadata.risk_assessment_source === "mcp" ? "MCP Server" : "Local Fallback",
                                },
                                {
                                    agent: "Coverage Determination",
                                    time: `${(processingMetadata.coverage_determination_processing_time * 1000).toFixed(0)}ms`,
                                    source: "Local Processing",
                                },
                                {
                                    agent: "Pricing Calculation",
                                    time: `${(processingMetadata.pricing_processing_time * 1000).toFixed(0)}ms`,
                                    source: "Local Processing",
                                },
                                {
                                    agent: "Quote Generation",
                                    time: `${(processingMetadata.quote_generation_processing_time * 1000).toFixed(0)}ms`,
                                    source: "Local Processing",
                                },
                            ]}
                        />
                        <Box padding={{ top: "s" }}>
                            <strong>Total Processing Time:</strong> {(processingMetadata.total_processing_time * 1000).toFixed(0)}ms
                        </Box>
                    </ExpandableSection>
                )}

                <Box textAlign="center" padding={{ top: "l" }}>
                    <SpaceBetween size="xs">
                        <Button
                            variant="primary"
                            onClick={() => alert("Purchase functionality would integrate with policy management system")}
                        >
                            Purchase This Policy
                        </Button>
                        <Button variant="link" onClick={handleNewQuote}>
                            Get Another Quote
                        </Button>
                    </SpaceBetween>
                </Box>
            </SpaceBetween>
        </Container>
    );
}

export default QuoteResult;
