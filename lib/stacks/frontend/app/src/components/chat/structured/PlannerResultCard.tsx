import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import Badge from "@cloudscape-design/components/badge";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import { Clock } from "lucide-react";
import type { PlannerResult } from "./types";
import { safe, safeArray } from "./safe-render";

const PRIORITY_COLOR: Record<string, "red" | "blue" | "grey"> = {
    high: "red",
    medium: "blue",
    low: "grey",
};

export function PlannerResultCard({ data }: { data: PlannerResult }): JSX.Element {
    return (
        <Container
            header={
                <Header variant="h3" description="Research Plan">
                    {safe(data.research_topic)}
                </Header>
            }
        >
            <SpaceBetween size="m">
                {/* Sub-questions */}
                <SpaceBetween size="xs">
                    {(Array.isArray(data.sub_questions) ? data.sub_questions : []).map((q, i) => (
                        <div
                            key={q.id || i}
                            className="flex gap-2 items-start p-2 rounded border border-gray-200 bg-gray-50"
                        >
                            <span className="font-mono text-sm text-gray-400 mt-0.5 shrink-0">
                                {i + 1}.
                            </span>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                    <span className="font-medium text-sm">{safe(q.question)}</span>
                                </div>
                                <div className="flex items-center gap-1.5 mb-0.5">
                                    <Badge color={PRIORITY_COLOR[q.priority] ?? "grey"}>
                                        {String(q.priority)}
                                    </Badge>
                                    <Badge color="blue">{String(q.type)}</Badge>
                                </div>
                                {q.rationale && (
                                    <Box color="text-body-secondary" fontSize="body-s">
                                        {safe(q.rationale)}
                                    </Box>
                                )}
                            </div>
                        </div>
                    ))}
                </SpaceBetween>

                {/* Estimated time */}
                {data.estimated_time && (
                    <Box color="text-body-secondary" fontSize="body-s">
                        <span className="inline-flex items-center gap-1">
                            <Clock size={14} />
                            {safe(data.estimated_time)}
                        </span>
                    </Box>
                )}

                {/* Collapsible details */}
                {(data.methodology ||
                    (data.dependencies &&
                        (Array.isArray(data.dependencies) ? data.dependencies : []).length >
                            0)) && (
                    <ExpandableSection headerText="Methodology & Dependencies" variant="footer">
                        <SpaceBetween size="s">
                            {data.methodology && (
                                <div>
                                    <Box variant="awsui-key-label">Methodology</Box>
                                    <Box>{safe(data.methodology)}</Box>
                                </div>
                            )}
                            {data.dependencies && safeArray(data.dependencies).length > 0 && (
                                <div>
                                    <Box variant="awsui-key-label">Dependencies</Box>
                                    <Box>{safeArray(data.dependencies).join(", ")}</Box>
                                </div>
                            )}
                        </SpaceBetween>
                    </ExpandableSection>
                )}
            </SpaceBetween>
        </Container>
    );
}
