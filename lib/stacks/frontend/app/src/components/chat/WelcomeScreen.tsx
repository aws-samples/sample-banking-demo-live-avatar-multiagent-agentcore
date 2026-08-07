import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import { Search, FileText, Brain, ClipboardList, Gauge } from "lucide-react";

interface WelcomeScreenProps {
    onExampleClick: (question: string) => void;
}

const STEPS = [
    {
        number: 1,
        label: "Plan",
        description: "Break down your research question into focused sub-tasks",
        icon: ClipboardList,
    },
    {
        number: 2,
        label: "Research",
        description: "Search knowledge bases, the web, and industry sources",
        icon: Search,
    },
    {
        number: 3,
        label: "Synthesize",
        description: "Analyze findings and extract key insights",
        icon: Brain,
    },
    {
        number: 4,
        label: "Report",
        description: "Generate a comprehensive PDF report with citations",
        icon: FileText,
    },
    {
        number: 5,
        label: "Evaluate",
        description: "Score the report against the brief and gathered evidence",
        icon: Gauge,
    },
];

const EXAMPLE_QUESTIONS = [
    {
        title: "TXSE Bank Strategy",
        question:
            "I have opened a new bank near the Texas Stock Exchange (TXSE) in Dallas, Texas. Please help me design a strategy and theme to operate the bank, including but not limited to know your customer (KYC), opening checking and savings accounts, providing retirement and investment services. In addition to the TXSE, the bank will also use the NYSE, Nasdaq, and the major stock exchanges in Europe. The strategy must include the ability to detect fraudulent accounts and transactions. Build a business plan, recommend the operating model, provide the staff recruitment requirements including salary, marketing and promotional strategies. Provide one best option rather than multiple choices. Based on the options, help me also generate a FAQ document for the customer to understand the details of the bank and its various services.",
    },
];

export function WelcomeScreen({ onExampleClick }: WelcomeScreenProps) {
    return (
        <div className="flex flex-col items-center max-w-4xl mx-auto py-12 px-4">
            <SpaceBetween size="xl" direction="vertical" alignItems="center">
                <div className="text-center">
                    <Box variant="h1" fontSize="heading-xl" fontWeight="bold">
                        Trinity Reserve Bank
                    </Box>
                    <Box variant="p" color="text-body-secondary" fontSize="heading-s">
                        Retail · Wealth · Markets
                    </Box>
                </div>

                <div className="w-full">
                    <Box
                        variant="h2"
                        fontSize="heading-m"
                        textAlign="center"
                        margin={{ bottom: "m" }}
                    >
                        How it works
                    </Box>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                        {STEPS.map((step) => {
                            const Icon = step.icon;
                            return (
                                <div
                                    key={step.number}
                                    className="flex flex-col items-center text-center p-4 rounded-xl transition-shadow duration-200"
                                    style={{
                                        background: "var(--glass-bg)",
                                        backdropFilter: "var(--glass-blur)",
                                        WebkitBackdropFilter: "var(--glass-blur)",
                                        border: "1px solid var(--glass-border)",
                                        boxShadow: "var(--card-shadow)",
                                    }}
                                >
                                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-700 font-bold mb-2">
                                        {step.number}
                                    </div>
                                    <Icon
                                        className="w-6 h-6 mb-2"
                                        style={{ color: "var(--app-text-secondary)" }}
                                    />
                                    <Box variant="h3" fontSize="heading-s">
                                        {step.label}
                                    </Box>
                                    <Box variant="p" color="text-body-secondary" fontSize="body-s">
                                        {step.description}
                                    </Box>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="w-full">
                    <Header variant="h2">Try the demo prompt</Header>
                    <div className="mt-4">
                        {EXAMPLE_QUESTIONS.map((item) => (
                            <button
                                key={item.title}
                                type="button"
                                onClick={() => onExampleClick(item.question)}
                                className="w-full text-left cursor-pointer bg-transparent border-0 p-0"
                            >
                                <Container header={<Header variant="h3">{item.title}</Header>}>
                                    <Box variant="p" color="text-body-secondary">
                                        {item.question}
                                    </Box>
                                </Container>
                            </button>
                        ))}
                    </div>
                </div>
            </SpaceBetween>
        </div>
    );
}

export default WelcomeScreen;
