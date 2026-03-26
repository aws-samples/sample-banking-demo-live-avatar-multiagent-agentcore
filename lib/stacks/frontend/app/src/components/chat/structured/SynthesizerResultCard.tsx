import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import { CheckCircle } from "lucide-react";
import { MarkdownRenderer } from "../MarkdownRenderer";
import type { SynthesizerResult } from "./types";
import { safe, safeArray } from "./safe-render";

const CONFIDENCE_TYPE: Record<string, "success" | "warning" | "stopped"> = {
    high: "success",
    medium: "warning",
    low: "stopped",
};

export function SynthesizerResultCard({ data }: { data: SynthesizerResult }): JSX.Element {
    return (
        <Container
            header={
                <Header variant="h3" description="Research Synthesis">
                    {safe(data.topic)}
                </Header>
            }
        >
            <SpaceBetween size="m">
                {/* Executive Summary */}
                <div className="p-3 rounded border-l-4 border-blue-500 bg-blue-50/40">
                    <Box variant="awsui-key-label">Executive Summary</Box>
                    <MarkdownRenderer content={safe(data.executive_summary)} />
                </div>

                {/* Key Findings */}
                {Array.isArray(data.key_findings) && data.key_findings.length > 0 && (
                    <div>
                        <Box variant="awsui-key-label">Key Findings</Box>
                        <SpaceBetween size="xs">
                            {data.key_findings.map((f, i) => (
                                <div
                                    key={i}
                                    className="p-3 rounded border border-gray-200 bg-white"
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-medium text-sm">{safe(f.theme)}</span>
                                        <StatusIndicator
                                            type={CONFIDENCE_TYPE[f.confidence] ?? "stopped"}
                                        >
                                            {safe(f.confidence)} confidence
                                        </StatusIndicator>
                                    </div>
                                    <Box fontSize="body-s">{safe(f.finding)}</Box>
                                    {Array.isArray(f.sources) && f.sources.length > 0 && (
                                        <div className="flex gap-1 mt-1.5 flex-wrap">
                                            {f.sources.map((s, j) => (
                                                <span
                                                    key={j}
                                                    className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded"
                                                >
                                                    {safe(s)}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </SpaceBetween>
                    </div>
                )}

                {/* Conclusions */}
                {data.conclusions && (
                    <div>
                        <Box variant="awsui-key-label">Conclusions</Box>
                        <Box fontSize="body-s">{safe(data.conclusions)}</Box>
                    </div>
                )}

                {/* Recommendations */}
                {safeArray(data.recommendations).length > 0 && (
                    <div>
                        <Box variant="awsui-key-label">Recommendations</Box>
                        <SpaceBetween size="xs">
                            {safeArray(data.recommendations).map((rec, i) => (
                                <div key={i} className="flex gap-2 items-start">
                                    <CheckCircle
                                        size={16}
                                        className="text-green-500 shrink-0 mt-0.5"
                                    />
                                    <Box fontSize="body-s">{rec}</Box>
                                </div>
                            ))}
                        </SpaceBetween>
                    </div>
                )}

                {/* Collapsible sections */}
                {(data.supporting_evidence ||
                    data.conflicts_and_uncertainties ||
                    safeArray(data.citations).length > 0) && (
                    <ExpandableSection
                        headerText="Supporting Evidence & Citations"
                        variant="footer"
                    >
                        <SpaceBetween size="s">
                            {data.supporting_evidence && (
                                <div>
                                    <Box variant="awsui-key-label">Supporting Evidence</Box>
                                    <Box fontSize="body-s">{safe(data.supporting_evidence)}</Box>
                                </div>
                            )}
                            {data.conflicts_and_uncertainties && (
                                <div>
                                    <Box variant="awsui-key-label">Conflicts & Uncertainties</Box>
                                    <Box fontSize="body-s">
                                        {safe(data.conflicts_and_uncertainties)}
                                    </Box>
                                </div>
                            )}
                            {safeArray(data.citations).length > 0 && (
                                <div>
                                    <Box variant="awsui-key-label">Citations</Box>
                                    <ol className="list-decimal pl-5 text-sm text-gray-600 space-y-0.5">
                                        {safeArray(data.citations).map((c, i) => (
                                            <li key={i}>{c}</li>
                                        ))}
                                    </ol>
                                </div>
                            )}
                        </SpaceBetween>
                    </ExpandableSection>
                )}
            </SpaceBetween>
        </Container>
    );
}
