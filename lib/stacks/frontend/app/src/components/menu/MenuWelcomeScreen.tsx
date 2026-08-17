import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import Alert from "@cloudscape-design/components/alert";
import Badge from "@cloudscape-design/components/badge";
import Button from "@cloudscape-design/components/button";
import Spinner from "@cloudscape-design/components/spinner";
import { Landmark, FileText } from "lucide-react";
import { useResearchStatus } from "@/hooks/useResearchStatus";

interface MenuWelcomeScreenProps {
    onExampleClick: (question: string) => void;
}

// These prompts deliberately reference the strategy/research report so the
// catalog is grounded in what the Deep Research Agent produced. The designer
// agent searches the strategy_research + market_research KB views first
// (MENU_DESIGNER_PROMPT), so phrasing them this way makes the grounding visible
// and ties the two experiences together. They still work if no report exists —
// kb_search simply returns nothing and the designer proceeds.
const EXAMPLE_PROMPTS = [
    {
        title: "Full Catalog from Strategy",
        question:
            "Using our Trinity Reserve strategy report, build the full client services catalog — everyday checking, high-yield savings, retirement, and managed investing — with an image for each product",
    },
];

export default function MenuWelcomeScreen({ onExampleClick }: MenuWelcomeScreenProps): JSX.Element {
    const { status, indexing, refresh } = useResearchStatus();
    const report = status?.latestReport ?? null;

    return (
        <div className="flex flex-col items-center max-w-4xl mx-auto py-12 px-4">
            <SpaceBetween size="xl" direction="vertical" alignItems="center">
                <div className="text-center">
                    <div className="flex items-center justify-center gap-3 mb-2">
                        <Landmark size={32} className="text-blue-600" />
                        <Box variant="h1" fontSize="heading-xl" fontWeight="bold">
                            AI Assistant
                        </Box>
                    </div>
                    <Box variant="p" color="text-body-secondary" fontSize="heading-s">
                        Design your services catalog with AI
                    </Box>
                </div>

                {/* Grounding readiness. Ingestion is asynchronous, so without
                    this the catalog can be designed with no grounding at all and
                    nothing explains why. */}
                <div className="w-full">
                    {indexing ? (
                        <Alert
                            type="info"
                            header="Indexing the strategy report"
                            action={<Button onClick={refresh}>Check again</Button>}
                        >
                            <SpaceBetween size="xs" direction="horizontal">
                                <Spinner />
                                <span>
                                    {report ? `“${report.title}” ` : "The latest report "}
                                    is being added to the knowledge base. You can start now, but the
                                    catalog will not be grounded in it until indexing completes.
                                </span>
                            </SpaceBetween>
                        </Alert>
                    ) : report ? (
                        <Alert type="success" header="Grounded in your latest research">
                            <span className="flex flex-wrap items-center gap-2">
                                <FileText size={14} />
                                <strong>{report.title}</strong>
                                {report.createdAt ? (
                                    <Badge>
                                        {new Date(report.createdAt).toLocaleString(undefined, {
                                            month: "short",
                                            day: "numeric",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })}
                                    </Badge>
                                ) : null}
                            </span>
                            <Box variant="small" color="text-body-secondary" margin={{ top: "xs" }}>
                                The catalog is pinned to this run only, so earlier research cannot
                                bleed into it.
                            </Box>
                        </Alert>
                    ) : (
                        <Alert type="warning" header="No deep research report yet">
                            Run the Deep Research Agent first to ground the catalog in your
                            strategy. You can still design from the standing product set.
                        </Alert>
                    )}
                </div>

                <div className="w-full">
                    <Header variant="h2">Try an example prompt</Header>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                        {EXAMPLE_PROMPTS.map((item) => (
                            <button
                                key={item.title}
                                type="button"
                                onClick={() => onExampleClick(item.question)}
                                className="text-left cursor-pointer bg-transparent border-0 p-0"
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
