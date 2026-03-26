import { useState } from "react";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Badge from "@cloudscape-design/components/badge";
import Button from "@cloudscape-design/components/button";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { FileText, ExternalLink } from "lucide-react";
import type { ToolRenderProps } from "@/hooks/useToolRenderer";

interface KbDocument {
    filename: string;
    url: string | null;
    pages_referenced: number[];
}

interface KbCitation {
    id: number;
    source: string;
    snippet: string;
    score: number;
    page: number | null;
    url: string | null;
}

interface KbSearchResult {
    query: string;
    results: Array<{
        content: string;
        score: number;
        source: string;
        page: number | null;
        url: string | null;
        citation_id: number;
    }>;
    citations: KbCitation[];
    documents: KbDocument[];
    result_count: number;
}

export function KbSearchResultCard({ name, status, result }: ToolRenderProps): JSX.Element {
    const [expandedDoc, setExpandedDoc] = useState<string | null>(null);

    if (status !== "complete" || !result) {
        return (
            <div className="my-1 text-sm">
                <span className="flex items-center gap-1.5">
                    <FileText size={14} style={{ color: "var(--app-text-secondary)" }} />
                    <span style={{ color: "var(--app-text-secondary)" }}>
                        {status === "streaming"
                            ? "Preparing search..."
                            : "Searching knowledge base..."}
                    </span>
                    <StatusIndicator type="in-progress">
                        {status === "streaming" ? "Streaming" : "Executing"}
                    </StatusIndicator>
                </span>
            </div>
        );
    }

    let parsed: KbSearchResult | null = null;
    try {
        parsed = JSON.parse(result);
    } catch {
        // Fall back to plain display if not parseable
    }

    if (!parsed || !parsed.documents || parsed.documents.length === 0) {
        if (!parsed || parsed.result_count === 0) {
            return (
                <div className="my-1 text-sm">
                    <ExpandableSection
                        variant="footer"
                        headerText={
                            <span className="flex items-center gap-1.5">
                                <FileText
                                    size={12}
                                    style={{ color: "var(--app-text-secondary)" }}
                                />
                                <span style={{ color: "var(--app-text-secondary)" }}>{name}</span>
                            </span>
                        }
                        headerActions={<StatusIndicator type="success">No results</StatusIndicator>}
                    >
                        <Box variant="p" color="text-body-secondary">
                            No matching documents found.
                        </Box>
                    </ExpandableSection>
                </div>
            );
        }
        // Has results but no documents array — old format, show simple
        return (
            <div className="my-1 text-sm">
                <ExpandableSection
                    variant="footer"
                    headerText={
                        <span className="flex items-center gap-1.5">
                            <FileText size={12} style={{ color: "var(--app-text-secondary)" }} />
                            <span style={{ color: "var(--app-text-secondary)" }}>{name}</span>
                        </span>
                    }
                    headerActions={<Badge color="blue">{parsed.result_count} results</Badge>}
                >
                    <pre
                        className="text-xs whitespace-pre-wrap break-words"
                        style={{ color: "var(--app-text-secondary)" }}
                    >
                        {result}
                    </pre>
                </ExpandableSection>
            </div>
        );
    }

    return (
        <div className="my-2">
            <ExpandableSection
                variant="footer"
                defaultExpanded
                headerText={
                    <span className="flex items-center gap-1.5">
                        <FileText size={14} style={{ color: "var(--app-accent)" }} />
                        <span style={{ color: "var(--app-text)" }}>Source Documents</span>
                        <Badge color="blue">{parsed.documents.length}</Badge>
                    </span>
                }
            >
                <SpaceBetween size="s">
                    {parsed.documents.map((doc) => (
                        <div
                            key={doc.filename}
                            className="rounded-lg overflow-hidden"
                            style={{
                                border: "1px solid var(--app-border)",
                                background: "var(--app-surface)",
                            }}
                        >
                            <div
                                className="flex items-center justify-between px-3 py-2 cursor-pointer"
                                onClick={() =>
                                    setExpandedDoc(
                                        expandedDoc === doc.filename ? null : doc.filename
                                    )
                                }
                                style={{
                                    borderBottom:
                                        expandedDoc === doc.filename
                                            ? "1px solid var(--app-border)"
                                            : "none",
                                }}
                            >
                                <span className="flex items-center gap-2">
                                    <FileText size={16} style={{ color: "var(--app-accent)" }} />
                                    <span
                                        className="text-sm font-medium"
                                        style={{ color: "var(--app-text)" }}
                                    >
                                        {doc.filename}
                                    </span>
                                    {doc.pages_referenced.length > 0 && (
                                        <span
                                            className="text-xs"
                                            style={{ color: "var(--app-text-secondary)" }}
                                        >
                                            Pages: {doc.pages_referenced.join(", ")}
                                        </span>
                                    )}
                                </span>
                                <span className="flex items-center gap-2">
                                    {doc.url && (
                                        <Button
                                            variant="icon"
                                            iconSvg={<ExternalLink size={14} />}
                                            href={doc.url}
                                            target="_blank"
                                            ariaLabel="Open document in new tab"
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    )}
                                    <span
                                        className="text-xs"
                                        style={{ color: "var(--app-text-secondary)" }}
                                    >
                                        {expandedDoc === doc.filename ? "Hide" : "View"}
                                    </span>
                                </span>
                            </div>

                            {expandedDoc === doc.filename && doc.url && (
                                <div style={{ height: "500px" }}>
                                    <iframe
                                        src={doc.url}
                                        title={doc.filename}
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            border: "none",
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Show citation snippets */}
                    {parsed.citations && parsed.citations.length > 0 && (
                        <ExpandableSection variant="footer" headerText="Citation Excerpts">
                            <SpaceBetween size="xs">
                                {parsed.citations.map((cite) => (
                                    <div
                                        key={cite.id}
                                        className="text-xs px-3 py-2 rounded"
                                        style={{
                                            background:
                                                "var(--app-surface-alt, var(--app-surface))",
                                            color: "var(--app-text-secondary)",
                                            borderLeft: "3px solid var(--app-accent)",
                                        }}
                                    >
                                        <div className="flex items-center gap-2 mb-1">
                                            <Badge color="blue">KB{cite.id}</Badge>
                                            <span className="font-medium">{cite.source}</span>
                                            {cite.page && <span>p.{cite.page}</span>}
                                            <span className="ml-auto">
                                                {(cite.score * 100).toFixed(0)}% match
                                            </span>
                                        </div>
                                        <div className="italic">{cite.snippet}</div>
                                    </div>
                                ))}
                            </SpaceBetween>
                        </ExpandableSection>
                    )}
                </SpaceBetween>
            </ExpandableSection>
        </div>
    );
}
