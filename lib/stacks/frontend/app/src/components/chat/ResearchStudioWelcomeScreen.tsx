import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import { Search, FileText, Brain, ClipboardList } from "lucide-react";

interface ResearchStudioWelcomeScreenProps {
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
        label: "Research + Visuals",
        description: "Search sources, generate illustrative images with Nova Canvas",
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
        label: "Visual Report",
        description: "Generate a PDF report with embedded images and citations",
        icon: FileText,
    },
];

const EXAMPLE_GROUPS = [
    {
        category: "Technology",
        icon: "💻",
        questions: [
            {
                title: "Agentic AI in Enterprise",
                question: "The impact of agentic AI on enterprise software development in 2026",
            },
            {
                title: "Quantum Computing",
                question:
                    "Current state of quantum error correction research and commercial viability",
            },
        ],
    },
    {
        category: "Business",
        icon: "📊",
        questions: [
            {
                title: "Supply Chain Resilience",
                question: "Global supply chain resilience strategies post-2025",
            },
            {
                title: "AI in Healthcare",
                question: "How AI is transforming clinical trials and drug discovery in 2026",
            },
        ],
    },
    {
        category: "Science",
        icon: "🔬",
        questions: [
            {
                title: "Climate Technology",
                question: "Breakthrough climate technologies and their scalability potential",
            },
            {
                title: "Neuroscience & AI",
                question: "Convergence of neuroscience and artificial intelligence research",
            },
        ],
    },
    {
        category: "Policy",
        icon: "🏛️",
        questions: [
            {
                title: "AI Regulation",
                question:
                    "Comparative analysis of AI regulation frameworks across US, EU, and Asia",
            },
            {
                title: "Future of Work",
                question:
                    "Economic impacts of AI automation on labor markets and workforce development",
            },
        ],
    },
];

export function ResearchStudioWelcomeScreen({ onExampleClick }: ResearchStudioWelcomeScreenProps) {
    return (
        <div className="flex flex-col items-center max-w-4xl mx-auto py-12 px-4">
            <SpaceBetween size="xl" direction="vertical" alignItems="center">
                <div className="text-center">
                    <Box variant="h1" fontSize="heading-xl" fontWeight="bold">
                        Research Studio
                    </Box>
                    <Box variant="p" color="text-body-secondary" fontSize="heading-s">
                        AI-Powered Deep Research with Visuals
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                    <Header variant="h2">Research any topic</Header>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                        {EXAMPLE_GROUPS.map((group) => (
                            <div key={group.category} className="flex flex-col gap-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">{group.icon}</span>
                                    <Box variant="h3" fontSize="heading-s">
                                        {group.category}
                                    </Box>
                                </div>
                                {group.questions.map((item) => (
                                    <button
                                        key={item.title}
                                        type="button"
                                        onClick={() => onExampleClick(item.question)}
                                        className="text-left cursor-pointer bg-transparent border-0 p-0"
                                    >
                                        <Container
                                            header={<Header variant="h3">{item.title}</Header>}
                                        >
                                            <Box variant="p" color="text-body-secondary">
                                                {item.question}
                                            </Box>
                                        </Container>
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </SpaceBetween>
        </div>
    );
}
