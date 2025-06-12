import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
    Box,
    Button,
    Cards,
    Container,
    Header,
    SpaceBetween,
    TextContent,
    ColumnLayout,
} from "@cloudscape-design/components";
import axios from "axios";

function Dashboard() {
    const navigate = useNavigate();
    const [customer, setCustomer] = useState(null);
    const [loading, setLoading] = useState(true);

    // For demo purposes, we'll use a hardcoded customer ID
    const customerId = "cust-001";

    useEffect(() => {
        const fetchCustomerData = async () => {
            try {
                const response = await axios.get(`http://localhost:8000/customers/${customerId}`);
                setCustomer(response.data);
            } catch (error) {
                console.error("Error fetching customer data:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchCustomerData();
    }, [customerId]);

    const handleGetFormQuote = () => {
        navigate("/quote");
    };

    const handleChatQuote = () => {
        navigate("/chat-quote");
    };

    if (loading) {
        return <div>Loading...</div>;
    }

    return (
        <Container>
            <SpaceBetween size="l">
                <Header
                    variant="h1"
                    actions={
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button variant="primary" onClick={handleChatQuote}>
                                Chat with Assistant
                            </Button>
                            <Button onClick={handleGetFormQuote}>Form Quote</Button>
                        </SpaceBetween>
                    }
                >
                    Welcome, {customer?.name}
                </Header>

                <Box padding={{ vertical: "l" }}>
                    <TextContent>
                        <h2>Your Insurance Dashboard</h2>
                        <p>
                            Manage your policies and get quotes for new vehicles with our AI-powered
                            insurance platform.
                        </p>
                    </TextContent>
                </Box>

                <ColumnLayout columns={2}>
                    <Box padding="l" bgcolor="light">
                        <SpaceBetween size="m">
                            <Header variant="h3">Get a Quote</Header>
                            <TextContent>
                                <p>Need insurance for a new vehicle? Get a quote in two ways:</p>
                            </TextContent>
                            <SpaceBetween size="s">
                                <Button onClick={handleChatQuote} iconName="chat">
                                    Chat with our AI Assistant
                                </Button>
                                <Button onClick={handleGetFormQuote} iconName="file">
                                    Fill out a Quote Form
                                </Button>
                            </SpaceBetween>
                        </SpaceBetween>
                    </Box>

                    <Box padding="l" bgcolor="light">
                        <SpaceBetween size="m">
                            <Header variant="h3">Customer Support</Header>
                            <TextContent>
                                <p>Have questions about your policy or need assistance?</p>
                            </TextContent>
                            <SpaceBetween size="s">
                                <Button iconName="contact">Contact Support</Button>
                                <Button iconName="file-open">View Policy Documents</Button>
                            </SpaceBetween>
                        </SpaceBetween>
                    </Box>
                </ColumnLayout>

                <Header variant="h2">Your Current Policies</Header>
                <Cards
                    cardDefinition={{
                        header: (item) => item.type.toUpperCase() + " INSURANCE",
                        sections: [
                            {
                                id: "details",
                                content: (item) => (
                                    <SpaceBetween size="l">
                                        <div>
                                            <div>
                                                <strong>Policy ID:</strong> {item.id}
                                            </div>
                                            <div>
                                                <strong>Status:</strong> {item.status}
                                            </div>
                                            <div>
                                                <strong>Premium:</strong> ${item.premium.toFixed(2)}
                                                /year
                                            </div>
                                            <div>
                                                <strong>Renewal Date:</strong> {item.end_date}
                                            </div>
                                        </div>
                                        {item.vehicles && (
                                            <div>
                                                <strong>Vehicle:</strong>{" "}
                                                {item.vehicles
                                                    .map((v) => `${v.year} ${v.make} ${v.model}`)
                                                    .join(", ")}
                                            </div>
                                        )}
                                    </SpaceBetween>
                                ),
                            },
                        ],
                    }}
                    cardsPerRow={[{ cards: 1 }, { minWidth: 500, cards: 2 }]}
                    items={[
                        {
                            id: "policy-001",
                            type: "auto",
                            status: "Active",
                            premium: 1200.0,
                            start_date: "2024-01-15",
                            end_date: "2025-01-15",
                            vehicles: [
                                {
                                    make: "Honda",
                                    model: "Accord",
                                    year: 2018,
                                },
                            ],
                        },
                    ]}
                    loadingText="Loading policies"
                    empty={
                        <Box textAlign="center" color="inherit">
                            <b>No policies found</b>
                            <Box padding={{ bottom: "s" }} variant="p" color="inherit">
                                You don't have any active policies.
                            </Box>
                        </Box>
                    }
                    header={<Header>Your policies</Header>}
                />
            </SpaceBetween>
        </Container>
    );
}

export default Dashboard;
