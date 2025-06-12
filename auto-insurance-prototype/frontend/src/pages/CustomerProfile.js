import React, { useState, useEffect } from "react";
import {
    Box,
    Button,
    ColumnLayout,
    Container,
    Header,
    SpaceBetween,
    Tabs,
    TextContent,
    Table,
} from "@cloudscape-design/components";
import axios from "axios";

function CustomerProfile() {
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

    if (loading) {
        return <div>Loading...</div>;
    }

    return (
        <Container>
            <SpaceBetween size="l">
                <Header variant="h1" actions={<Button>Edit Profile</Button>}>
                    Customer Profile
                </Header>

                <Box padding="l" bgcolor="light">
                    <ColumnLayout columns={2} variant="text-grid">
                        <SpaceBetween size="l">
                            <TextContent>
                                <h3>Personal Information</h3>
                                <p>
                                    <strong>Name:</strong> {customer.name}
                                </p>
                                <p>
                                    <strong>Email:</strong> {customer.email}
                                </p>
                                <p>
                                    <strong>Phone:</strong> {customer.phone}
                                </p>
                                <p>
                                    <strong>Date of Birth:</strong> {customer.dob}
                                </p>
                            </TextContent>
                        </SpaceBetween>

                        <SpaceBetween size="l">
                            <TextContent>
                                <h3>Address</h3>
                                <p>{customer.address}</p>
                            </TextContent>
                        </SpaceBetween>
                    </ColumnLayout>
                </Box>

                <Tabs
                    tabs={[
                        {
                            label: "Driving History",
                            id: "driving-history",
                            content: (
                                <SpaceBetween size="l">
                                    <Box padding={{ top: "l" }}>
                                        <TextContent>
                                            <h3>License Information</h3>
                                            <p>
                                                <strong>License Number:</strong>{" "}
                                                {customer.driving_history.license_number}
                                            </p>
                                            <p>
                                                <strong>State:</strong>{" "}
                                                {customer.driving_history.license_state}
                                            </p>
                                            <p>
                                                <strong>Issue Date:</strong>{" "}
                                                {customer.driving_history.license_issue_date}
                                            </p>
                                        </TextContent>
                                    </Box>

                                    <Header variant="h3">Accidents</Header>
                                    <Table
                                        columnDefinitions={[
                                            {
                                                id: "date",
                                                header: "Date",
                                                cell: (item) => item.date,
                                            },
                                            {
                                                id: "severity",
                                                header: "Severity",
                                                cell: (item) => item.severity,
                                            },
                                            {
                                                id: "at_fault",
                                                header: "At Fault",
                                                cell: (item) => (item.at_fault ? "Yes" : "No"),
                                            },
                                        ]}
                                        items={customer.driving_history.accidents}
                                        empty={
                                            <Box textAlign="center" color="inherit">
                                                <b>No accidents on record</b>
                                                <Box
                                                    padding={{ bottom: "s" }}
                                                    variant="p"
                                                    color="inherit"
                                                >
                                                    Great job maintaining a clean driving record!
                                                </Box>
                                            </Box>
                                        }
                                    />

                                    <Header variant="h3">Violations</Header>
                                    <Table
                                        columnDefinitions={[
                                            {
                                                id: "date",
                                                header: "Date",
                                                cell: (item) => item.date,
                                            },
                                            {
                                                id: "type",
                                                header: "Type",
                                                cell: (item) => item.type,
                                            },
                                            {
                                                id: "points",
                                                header: "Points",
                                                cell: (item) => item.points,
                                            },
                                        ]}
                                        items={customer.driving_history.violations}
                                        empty={
                                            <Box textAlign="center" color="inherit">
                                                <b>No violations on record</b>
                                                <Box
                                                    padding={{ bottom: "s" }}
                                                    variant="p"
                                                    color="inherit"
                                                >
                                                    Great job maintaining a clean driving record!
                                                </Box>
                                            </Box>
                                        }
                                    />
                                </SpaceBetween>
                            ),
                        },
                        {
                            label: "Policies",
                            id: "policies",
                            content: (
                                <SpaceBetween size="l">
                                    <Box padding={{ top: "l" }}>
                                        <TextContent>
                                            <h3>Current Policies</h3>
                                        </TextContent>
                                    </Box>

                                    <Table
                                        columnDefinitions={[
                                            {
                                                id: "id",
                                                header: "Policy ID",
                                                cell: (item) => item.id,
                                            },
                                            {
                                                id: "type",
                                                header: "Type",
                                                cell: (item) => item.type,
                                            },
                                            {
                                                id: "start_date",
                                                header: "Start Date",
                                                cell: (item) => item.start_date,
                                            },
                                            {
                                                id: "end_date",
                                                header: "End Date",
                                                cell: (item) => item.end_date,
                                            },
                                            {
                                                id: "premium",
                                                header: "Premium",
                                                cell: (item) => `$${item.premium.toFixed(2)}`,
                                            },
                                            {
                                                id: "status",
                                                header: "Status",
                                                cell: (item) => item.status,
                                            },
                                        ]}
                                        items={[
                                            {
                                                id: "policy-001",
                                                type: "Auto",
                                                start_date: "2024-01-15",
                                                end_date: "2025-01-15",
                                                premium: 1200.0,
                                                status: "Active",
                                            },
                                        ]}
                                        empty={
                                            <Box textAlign="center" color="inherit">
                                                <b>No policies found</b>
                                                <Box
                                                    padding={{ bottom: "s" }}
                                                    variant="p"
                                                    color="inherit"
                                                >
                                                    You don't have any active policies.
                                                </Box>
                                            </Box>
                                        }
                                    />
                                </SpaceBetween>
                            ),
                        },
                    ]}
                />
            </SpaceBetween>
        </Container>
    );
}

export default CustomerProfile;
