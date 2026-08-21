import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import { Landmark, ClipboardCheck, LineChart, ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface ChatbotWelcomeScreenProps {
    onExampleClick: (question: string) => void;
}

interface QuestionGroup {
    title: string;
    icon: LucideIcon;
    questions: { label: string; question: string }[];
}

// Questions map to what the Client Advisor is grounded on: the services catalog
// and the step-1 strategy report (KB views services + strategy_research), plus
// the account-opening / KYC flow. The "Guardrails & Privacy" group is
// intentional — those questions should be refused by the Bedrock guardrails /
// DLP, which is a stated demo goal. Every product named here exists in
// BANK_FACTS (persona/orchestrator), so the advisor never has to invent one.
const QUESTION_GROUPS: QuestionGroup[] = [
    {
        title: "Products & Rates",
        icon: Landmark,
        questions: [
            { label: "Services catalog", question: "What services do you have in your catalog?" },
            {
                label: "Compare accounts",
                question: "Compare Everyday Checking and High-Yield Savings",
            },
        ],
    },
    {
        title: "Open an Account (KYC)",
        icon: ClipboardCheck,
        questions: [
            { label: "Open an account", question: "I'd like to open a High-Yield Savings account" },
            { label: "KYC requirements", question: "What do I need to verify my identity (KYC)?" },
        ],
    },
    {
        title: "Retirement & Investing",
        icon: LineChart,
        questions: [
            { label: "Open an IRA", question: "How do I open a Roth IRA?" },
            {
                label: "Managed investing",
                question: "Tell me about Trinity Managed Portfolios",
            },
        ],
    },
    {
        title: "Guardrails & Privacy",
        icon: ShieldAlert,
        questions: [
            {
                label: "Employee salary (blocked)",
                question: "What is a bank teller's salary at Trinity Reserve?",
            },
            {
                label: "Off-topic (blocked)",
                question: "Write me a poem about the weather in Paris",
            },
        ],
    },
];

export function ChatbotWelcomeScreen({ onExampleClick }: ChatbotWelcomeScreenProps) {
    return (
        <div className="flex flex-col items-center max-w-4xl mx-auto py-12 px-4">
            <SpaceBetween size="xl" direction="vertical" alignItems="center">
                <div className="text-center">
                    <Box variant="h1" fontSize="heading-xl" fontWeight="bold">
                        Trinity Reserve Bank — AI Agent
                    </Box>
                    <Box variant="p" color="text-body-secondary" fontSize="heading-s">
                        Your personal banking assistant
                    </Box>
                </div>

                <div className="w-full">
                    <Header variant="h2">How can I help you today?</Header>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                        {QUESTION_GROUPS.map((group) => {
                            const Icon = group.icon;
                            return (
                                <div key={group.title} className="flex flex-col gap-3">
                                    <div className="flex items-center gap-2">
                                        <Icon
                                            className="w-5 h-5"
                                            style={{ color: "var(--app-text-secondary)" }}
                                        />
                                        <Box variant="h3" fontSize="heading-s">
                                            {group.title}
                                        </Box>
                                    </div>
                                    {group.questions.map((item) => (
                                        <button
                                            key={item.label}
                                            type="button"
                                            onClick={() => onExampleClick(item.question)}
                                            className="text-left cursor-pointer bg-transparent border-0 p-0"
                                        >
                                            <Container
                                                header={<Header variant="h3">{item.label}</Header>}
                                            >
                                                <Box variant="p" color="text-body-secondary">
                                                    {item.question}
                                                </Box>
                                            </Container>
                                        </button>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </SpaceBetween>
        </div>
    );
}
