import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import Badge from "@cloudscape-design/components/badge";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import { Book, Globe, Lightbulb } from "lucide-react";
import type { ResearcherResult } from "./types";
import { safe, safeArray } from "./safe-render";

export function ResearcherResultCard({ data }: { data: ResearcherResult }): JSX.Element {
    return (
        <Container
            header={
                <Header variant="h3" description={safe(data.question)}>
                    Research Findings
                </Header>
            }
        >
            <SpaceBetween size="m">
                {/* KB Findings */}
                {Array.isArray(data.kb_findings) && data.kb_findings.length > 0 && (
                    <div>
                        <Box variant="awsui-key-label">
                            <span className="inline-flex items-center gap-1">
                                <Book size={14} /> Knowledge Base Findings
                            </span>
                        </Box>
                        <SpaceBetween size="xs">
                            {data.kb_findings.map((f, i) => (
                                <div
                                    key={i}
                                    className="p-2 rounded border border-blue-100 bg-blue-50/50"
                                >
                                    <Box fontSize="body-s">{safe(f.content)}</Box>
                                    <div className="flex items-center gap-1.5 mt-1">
                                        {f.source && <Badge color="blue">{safe(f.source)}</Badge>}
                                        {f.relevance && (
                                            <Badge color="grey">{safe(f.relevance)}</Badge>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </SpaceBetween>
                    </div>
                )}

                {/* Web Findings */}
                {Array.isArray(data.web_findings) && data.web_findings.length > 0 && (
                    <div>
                        <Box variant="awsui-key-label">
                            <span className="inline-flex items-center gap-1">
                                <Globe size={14} /> Web Findings
                            </span>
                        </Box>
                        <SpaceBetween size="xs">
                            {data.web_findings.map((f, i) => (
                                <div
                                    key={i}
                                    className="p-2 rounded border border-green-100 bg-green-50/50"
                                >
                                    <Box fontSize="body-s">{safe(f.content)}</Box>
                                    <div className="flex items-center gap-1.5 mt-1">
                                        {f.sub_question && (
                                            <Badge color="blue">{safe(f.sub_question)}</Badge>
                                        )}
                                        {f.source &&
                                            (f.url ? (
                                                <a
                                                    href={f.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs text-blue-600 underline"
                                                >
                                                    {safe(f.source)}
                                                </a>
                                            ) : (
                                                <Badge color="grey">{safe(f.source)}</Badge>
                                            ))}
                                    </div>
                                </div>
                            ))}
                        </SpaceBetween>
                    </div>
                )}

                {/* Key Insights */}
                {safeArray(data.key_insights).length > 0 && (
                    <div>
                        <Box variant="awsui-key-label">
                            <span className="inline-flex items-center gap-1">
                                <Lightbulb size={14} /> Key Insights
                            </span>
                        </Box>
                        <SpaceBetween size="xs">
                            {safeArray(data.key_insights).map((insight, i) => (
                                <div
                                    key={i}
                                    className="flex gap-2 items-start p-2 rounded border border-yellow-200 bg-yellow-50/50"
                                >
                                    <Lightbulb
                                        size={14}
                                        className="text-yellow-500 shrink-0 mt-0.5"
                                    />
                                    <Box fontSize="body-s">{insight}</Box>
                                </div>
                            ))}
                        </SpaceBetween>
                    </div>
                )}

                {/* Gaps */}
                {data.gaps && (
                    <div>
                        <Box variant="awsui-key-label">Research Gaps</Box>
                        <Box fontSize="body-s" color="text-body-secondary">
                            {safe(data.gaps)}
                        </Box>
                    </div>
                )}

                {/* Citations */}
                {safeArray(data.citations).length > 0 && (
                    <ExpandableSection
                        headerText={`Citations (${safeArray(data.citations).length})`}
                        variant="footer"
                    >
                        <ol className="list-decimal pl-5 text-sm text-gray-600 space-y-0.5">
                            {safeArray(data.citations).map((c, i) => (
                                <li key={i}>{c}</li>
                            ))}
                        </ol>
                    </ExpandableSection>
                )}
            </SpaceBetween>
        </Container>
    );
}
