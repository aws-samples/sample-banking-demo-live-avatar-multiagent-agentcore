import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import { Library, Search, GitCompare, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface ArchiveWelcomeScreenProps {
    onExampleClick: (question: string) => void;
}

interface QuestionGroup {
    title: string;
    icon: LucideIcon;
    questions: { label: string; question: string }[];
}

const QUESTION_GROUPS: QuestionGroup[] = [
    {
        title: "Browse",
        icon: Library,
        questions: [
            { label: "All Reports", question: "What research reports have been generated so far?" },
            { label: "Recent Topics", question: "What topics have been researched recently?" },
        ],
    },
    {
        title: "Search",
        icon: Search,
        questions: [
            {
                label: "AI Findings",
                question: "Summarize the key findings from AI-related research",
            },
            { label: "By Topic", question: "What do we know about enterprise software trends?" },
        ],
    },
    {
        title: "Compare",
        icon: GitCompare,
        questions: [
            {
                label: "Cross-Report",
                question: "Compare findings across different research topics",
            },
            {
                label: "Recommendations",
                question: "What recommendations were made across all reports?",
            },
        ],
    },
    {
        title: "Trends",
        icon: TrendingUp,
        questions: [
            { label: "Common Themes", question: "What common themes appear across all research?" },
            {
                label: "Key Insights",
                question: "What are the most impactful insights from past research?",
            },
        ],
    },
];

export function ArchiveWelcomeScreen({ onExampleClick }: ArchiveWelcomeScreenProps) {
    return (
        <div className="flex flex-col items-center max-w-4xl mx-auto py-12 px-4">
            <SpaceBetween size="xl" direction="vertical" alignItems="center">
                <div className="text-center">
                    <Box variant="h1" fontSize="heading-xl" fontWeight="bold">
                        Research Archive
                    </Box>
                    <Box variant="p" color="text-body-secondary" fontSize="heading-s">
                        Query Your Research Library
                    </Box>
                </div>

                <div className="w-full">
                    <Header variant="h2">What would you like to explore?</Header>
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
