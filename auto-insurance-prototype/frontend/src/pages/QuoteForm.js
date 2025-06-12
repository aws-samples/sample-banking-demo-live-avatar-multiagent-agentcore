import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
    Box,
    Button,
    Container,
    Form,
    FormField,
    Header,
    Select,
    SpaceBetween,
    Spinner,
    Checkbox,
    Tiles,
} from "@cloudscape-design/components";
import axios from "axios";

function QuoteForm() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [vehicles, setVehicles] = useState([]);
    const [makes, setMakes] = useState([]);
    const [models, setModels] = useState([]);
    const [years, setYears] = useState([]);

    // Form state
    const [selectedMake, setSelectedMake] = useState(null);
    const [selectedModel, setSelectedModel] = useState(null);
    const [selectedYear, setSelectedYear] = useState(null);
    const [coverageLevel, setCoverageLevel] = useState(null);
    const [deductible, setDeductible] = useState(null);
    const [additionalCoverage, setAdditionalCoverage] = useState({
        roadside: false,
        rental: false,
        gap: false,
    });

    // For demo purposes, we'll use a hardcoded customer ID
    const customerId = "cust-001";

    useEffect(() => {
        const fetchVehicleData = async () => {
            try {
                const response = await axios.get("http://localhost:8000/vehicles");
                setVehicles(response.data);

                // Extract unique makes
                const uniqueMakes = [...new Set(response.data.map((vehicle) => vehicle.make))];
                setMakes(uniqueMakes.map((make) => ({ value: make, label: make })));
            } catch (error) {
                console.error("Error fetching vehicle data:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchVehicleData();
    }, []);

    // Update models when make changes
    useEffect(() => {
        if (selectedMake) {
            const filteredVehicles = vehicles.filter(
                (vehicle) => vehicle.make === selectedMake.value
            );
            const uniqueModels = [...new Set(filteredVehicles.map((vehicle) => vehicle.model))];
            setModels(uniqueModels.map((model) => ({ value: model, label: model })));
            setSelectedModel(null);
            setSelectedYear(null);
        } else {
            setModels([]);
        }
    }, [selectedMake, vehicles]);

    // Update years when model changes
    useEffect(() => {
        if (selectedMake && selectedModel) {
            const filteredVehicles = vehicles.filter(
                (vehicle) =>
                    vehicle.make === selectedMake.value && vehicle.model === selectedModel.value
            );

            if (filteredVehicles.length > 0) {
                const availableYears = filteredVehicles[0].years;
                setYears(
                    availableYears.map((year) => ({
                        value: year.toString(),
                        label: year.toString(),
                    }))
                );
            }
            setSelectedYear(null);
        } else {
            setYears([]);
        }
    }, [selectedModel, selectedMake, vehicles]);

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!selectedMake || !selectedModel || !selectedYear || !coverageLevel || !deductible) {
            alert("Please fill out all required fields");
            return;
        }

        setSubmitting(true);

        const additionalCoverageArray = [];
        if (additionalCoverage.roadside) additionalCoverageArray.push("roadside_assistance");
        if (additionalCoverage.rental) additionalCoverageArray.push("rental_reimbursement");
        if (additionalCoverage.gap) additionalCoverageArray.push("gap_insurance");

        try {
            // Use the enhanced API endpoint
            const response = await axios.post("http://localhost:8000/api/quotes", {
                customer_id: customerId,
                vehicle_info: {
                    make: selectedMake.value,
                    model: selectedModel.value,
                    year: parseInt(selectedYear.value),
                },
                coverage_type: coverageLevel.value
            });

            // Store the quote result in sessionStorage to access it on the result page
            sessionStorage.setItem("quoteResult", JSON.stringify(response.data));
            sessionStorage.setItem("processingMetadata", JSON.stringify(response.data.processing_metadata));

            // Navigate to the result page
            navigate("/quote-result");
        } catch (error) {
            console.error("Error submitting quote request:", error);
            let errorMessage = "There was an error processing your quote. Please try again.";
            
            if (error.response?.data?.detail) {
                errorMessage = `Quote generation failed: ${error.response.data.detail}`;
            }
            
            alert(errorMessage);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <Box textAlign="center" padding={{ top: "xxxl" }}>
                <Spinner size="large" />
                <Box variant="p" padding={{ top: "s" }}>
                    Loading vehicle data...
                </Box>
            </Box>
        );
    }

    return (
        <Container>
            <SpaceBetween size="l">
                <Header variant="h1">Get an Auto Insurance Quote</Header>

                <Form
                    actions={
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button variant="link" onClick={() => navigate("/")}>
                                Cancel
                            </Button>
                            <Button variant="primary" onClick={handleSubmit} loading={submitting}>
                                Get Quote
                            </Button>
                        </SpaceBetween>
                    }
                >
                    <SpaceBetween size="l">
                        <Header variant="h2">Vehicle Information</Header>

                        <FormField label="Make">
                            <Select
                                selectedOption={selectedMake}
                                onChange={({ detail }) => setSelectedMake(detail.selectedOption)}
                                options={makes}
                                placeholder="Select a make"
                            />
                        </FormField>

                        <FormField label="Model">
                            <Select
                                selectedOption={selectedModel}
                                onChange={({ detail }) => setSelectedModel(detail.selectedOption)}
                                options={models}
                                placeholder="Select a model"
                                disabled={!selectedMake}
                            />
                        </FormField>

                        <FormField label="Year">
                            <Select
                                selectedOption={selectedYear}
                                onChange={({ detail }) => setSelectedYear(detail.selectedOption)}
                                options={years}
                                placeholder="Select a year"
                                disabled={!selectedModel}
                            />
                        </FormField>

                        <Header variant="h2">Coverage Options</Header>

                        <FormField label="Coverage Level">
                            <Tiles
                                value={coverageLevel?.value}
                                onChange={({ detail }) =>
                                    setCoverageLevel({ value: detail.value, label: detail.value })
                                }
                                items={[
                                    {
                                        value: "basic",
                                        label: "Basic",
                                        description: "Minimum coverage required by law",
                                    },
                                    {
                                        value: "standard",
                                        label: "Standard",
                                        description: "Balanced coverage for most drivers",
                                    },
                                    {
                                        value: "premium",
                                        label: "Premium",
                                        description: "Maximum protection for you and your vehicle",
                                    },
                                ]}
                            />
                        </FormField>

                        <FormField label="Deductible">
                            <Select
                                selectedOption={deductible}
                                onChange={({ detail }) => setDeductible(detail.selectedOption)}
                                options={[
                                    { value: "250", label: "$250" },
                                    { value: "500", label: "$500" },
                                    { value: "1000", label: "$1,000" },
                                    { value: "2000", label: "$2,000" },
                                ]}
                                placeholder="Select a deductible"
                            />
                        </FormField>

                        <FormField label="Additional Coverage">
                            <SpaceBetween size="s">
                                <Checkbox
                                    checked={additionalCoverage.roadside}
                                    onChange={({ detail }) =>
                                        setAdditionalCoverage({
                                            ...additionalCoverage,
                                            roadside: detail.checked,
                                        })
                                    }
                                >
                                    Roadside Assistance
                                </Checkbox>
                                <Checkbox
                                    checked={additionalCoverage.rental}
                                    onChange={({ detail }) =>
                                        setAdditionalCoverage({
                                            ...additionalCoverage,
                                            rental: detail.checked,
                                        })
                                    }
                                >
                                    Rental Car Reimbursement
                                </Checkbox>
                                <Checkbox
                                    checked={additionalCoverage.gap}
                                    onChange={({ detail }) =>
                                        setAdditionalCoverage({
                                            ...additionalCoverage,
                                            gap: detail.checked,
                                        })
                                    }
                                >
                                    Gap Insurance
                                </Checkbox>
                            </SpaceBetween>
                        </FormField>
                    </SpaceBetween>
                </Form>
            </SpaceBetween>
        </Container>
    );
}

export default QuoteForm;
