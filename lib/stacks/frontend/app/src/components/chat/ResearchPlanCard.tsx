import { useState } from "react";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Box from "@cloudscape-design/components/box";
import Badge from "@cloudscape-design/components/badge";
import Modal from "@cloudscape-design/components/modal";
import Textarea from "@cloudscape-design/components/textarea";
import FormField from "@cloudscape-design/components/form-field";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { Search, Clock, Target, FileText } from "lucide-react";

interface SubQuestion {
    id: number;
    question: string;
    priority: "high" | "medium" | "low";
    type: "web" | "kb" | "analysis";
    rationale: string;
}

interface ResearchPlan {
    research_topic: string;
    objectives?: string[];
    /**
     * Optional defensively: this comes from LLM output, and a plan missing it
     * used to throw while initialising the editable state below, which blanked
     * the card and left no approval controls at all.
     */
    sub_questions?: SubQuestion[];
    methodology: string;
    expected_deliverables?: string[];
    timeline?: string;
    dependencies?: string;
    estimated_time?: string;
}

interface ResearchPlanCardProps {
    plan: ResearchPlan;
    query: string;
    onAction?: (action: string, data: unknown) => void;
}

const PRIORITY_COLORS: Record<string, "blue" | "grey" | "red"> = {
    high: "red",
    medium: "blue",
    low: "grey",
};

export function ResearchPlanCard({ plan, query, onAction }: ResearchPlanCardProps): JSX.Element {
    // Normalised once so every use below is safe against a plan that came
    // back without questions.
    const subQuestions = plan.sub_questions ?? [];

    const [isEditing, setIsEditing] = useState(false);
    const [isApproved, setIsApproved] = useState(false);

    // Editable state
    const [editObjectives, setEditObjectives] = useState((plan.objectives || []).join("\n"));
    const [editMethodology, setEditMethodology] = useState(plan.methodology || "");
    const [editQuestions, setEditQuestions] = useState(
        subQuestions.map((q) => q.question).join("\n")
    );
    const [editDeliverables, setEditDeliverables] = useState(
        (plan.expected_deliverables || []).join("\n")
    );

    const handleApprove = (): void => {
        setIsApproved(true);

        // Build the approved plan with any edits
        const approvedPlan: ResearchPlan = {
            ...plan,
            objectives: editObjectives
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            methodology: editMethodology,
            sub_questions: editQuestions
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((q, i) => ({
                    id: i + 1,
                    question: q,
                    priority: subQuestions[i]?.priority || "medium",
                    type: subQuestions[i]?.type || "web",
                    rationale: subQuestions[i]?.rationale || "",
                })),
            expected_deliverables: editDeliverables
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
        };

        onAction?.("research_execute", { plan: approvedPlan, query });
    };

    const handleStartOver = (): void => {
        onAction?.("start_over", { query });
    };

    const handleSaveEdits = (): void => {
        setIsEditing(false);
    };

    const objectives = plan.objectives || [];
    const deliverables = plan.expected_deliverables || [];

    // Calculate a realistic timeline based on question count instead of
    // trusting the LLM's guess.  Each question ≈ 30-45s of KB + web searches
    // running sequentially, plus ~60s for synthesis and ~30s for PDF generation.
    const questionCount = subQuestions.length || 5;
    const researchMinutes = Math.ceil((questionCount * 40) / 60); // ~40s per question
    const overheadMinutes = 2; // synthesis + PDF generation
    const lowMinutes = researchMinutes + overheadMinutes;
    const highMinutes = lowMinutes + Math.ceil(questionCount / 3); // buffer for retries / slow tools
    const timeline = `${lowMinutes}\u2013${highMinutes} minutes (~${questionCount} research questions)`;

    return (
        <div className="my-3">
            <Container
                header={
                    <Header variant="h2" description={plan.research_topic}>
                        Research Plan
                    </Header>
                }
            >
                <SpaceBetween size="l">
                    {/* Objectives */}
                    {objectives.length > 0 && (
                        <div>
                            <Box variant="h3">
                                <span className="flex items-center gap-2">
                                    <Target size={16} />
                                    Objectives
                                </span>
                            </Box>
                            <SpaceBetween size="xs">
                                {objectives.map((obj, i) => (
                                    <div key={i} className="flex items-start gap-2 mt-1">
                                        <Badge color="blue">{i + 1}</Badge>
                                        <Box variant="p">{obj}</Box>
                                    </div>
                                ))}
                            </SpaceBetween>
                        </div>
                    )}

                    {/* Methodology */}
                    {plan.methodology && (
                        <div>
                            <Box variant="h3">
                                <span className="flex items-center gap-2">
                                    <Search size={16} />
                                    Methodology
                                </span>
                            </Box>
                            <Box variant="p">{plan.methodology}</Box>
                        </div>
                    )}

                    {/* Key Questions */}
                    {subQuestions.length > 0 && (
                        <div>
                            <Box variant="h3">
                                <span className="flex items-center gap-2">
                                    <Search size={16} />
                                    Research Questions ({subQuestions.length})
                                </span>
                            </Box>
                            <SpaceBetween size="xs">
                                {subQuestions.map((q) => (
                                    <div
                                        key={q.id}
                                        className="flex items-start gap-2 mt-1 p-2 rounded"
                                        style={{
                                            background:
                                                "var(--color-background-layout-main, #fafafa)",
                                        }}
                                    >
                                        <Badge color={PRIORITY_COLORS[q.priority] || "grey"}>
                                            {q.priority.toUpperCase()}
                                        </Badge>
                                        <div className="flex-1">
                                            <Box variant="p" fontWeight="bold">
                                                {q.question}
                                            </Box>
                                            {q.rationale && (
                                                <Box variant="small" color="text-body-secondary">
                                                    {q.rationale}
                                                </Box>
                                            )}
                                        </div>
                                        <Badge>{q.type}</Badge>
                                    </div>
                                ))}
                            </SpaceBetween>
                        </div>
                    )}

                    {/* Deliverables & Timeline */}
                    <ColumnLayout columns={2}>
                        {deliverables.length > 0 && (
                            <div>
                                <Box variant="h3">
                                    <span className="flex items-center gap-2">
                                        <FileText size={16} />
                                        Expected Deliverables
                                    </span>
                                </Box>
                                <SpaceBetween size="xxs">
                                    {deliverables.map((d, i) => (
                                        <Box key={i} variant="p">
                                            &bull; {d}
                                        </Box>
                                    ))}
                                </SpaceBetween>
                            </div>
                        )}
                        <div>
                            <Box variant="h3">
                                <span className="flex items-center gap-2">
                                    <Clock size={16} />
                                    Estimated Timeline
                                </span>
                            </Box>
                            <Box variant="p">{timeline}</Box>
                        </div>
                    </ColumnLayout>

                    {/* Action Buttons */}
                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            {!isApproved && (
                                <>
                                    <Button onClick={() => setIsEditing(true)} variant="normal">
                                        Customize Plan
                                    </Button>
                                    <Button onClick={handleStartOver} variant="normal">
                                        Start Over
                                    </Button>
                                    <Button onClick={handleApprove} variant="primary">
                                        Approve &amp; Start Research
                                    </Button>
                                </>
                            )}
                            {isApproved && (
                                <StatusIndicator type="loading">
                                    Starting Research...
                                </StatusIndicator>
                            )}
                        </SpaceBetween>
                    </Box>
                </SpaceBetween>
            </Container>

            {/* Edit Modal */}
            <Modal
                visible={isEditing}
                onDismiss={() => setIsEditing(false)}
                header="Customize Research Plan"
                size="large"
                footer={
                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button onClick={() => setIsEditing(false)} variant="link">
                                Cancel
                            </Button>
                            <Button onClick={handleSaveEdits} variant="primary">
                                Save Changes
                            </Button>
                        </SpaceBetween>
                    </Box>
                }
            >
                <SpaceBetween size="l">
                    <FormField label="Objectives" description="One objective per line">
                        <Textarea
                            value={editObjectives}
                            onChange={({ detail }) => setEditObjectives(detail.value)}
                            rows={4}
                        />
                    </FormField>
                    <FormField label="Methodology" description="How the research will be conducted">
                        <Textarea
                            value={editMethodology}
                            onChange={({ detail }) => setEditMethodology(detail.value)}
                            rows={3}
                        />
                    </FormField>
                    <FormField
                        label="Research Questions"
                        description="One question per line. Order determines priority."
                    >
                        <Textarea
                            value={editQuestions}
                            onChange={({ detail }) => setEditQuestions(detail.value)}
                            rows={8}
                        />
                    </FormField>
                    <FormField label="Expected Deliverables" description="One deliverable per line">
                        <Textarea
                            value={editDeliverables}
                            onChange={({ detail }) => setEditDeliverables(detail.value)}
                            rows={4}
                        />
                    </FormField>
                </SpaceBetween>
            </Modal>
        </div>
    );
}
