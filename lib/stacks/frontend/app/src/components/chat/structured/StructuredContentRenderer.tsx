import { useMemo } from "react";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { splitContent } from "./json-detector";
import { PlannerResultCard } from "./PlannerResultCard";
import { ResearcherResultCard } from "./ResearcherResultCard";
import { SynthesizerResultCard } from "./SynthesizerResultCard";
import { PdfWriterResultCard } from "./PdfWriterResultCard";
import type { PlannerResult, ResearcherResult, SynthesizerResult, PdfWriterResult } from "./types";

export function StructuredContentRenderer({ content }: { content: string }): JSX.Element | null {
    const parts = useMemo(() => splitContent(content), [content]);

    // Fast path: single text part — just render markdown
    if (parts.length === 1 && parts[0].type === "text") {
        return <MarkdownRenderer content={parts[0].content} />;
    }

    return (
        <>
            {parts.map((part, i) => {
                if (part.type === "text") {
                    return <MarkdownRenderer key={i} content={part.content} />;
                }

                switch (part.structuredType) {
                    case "planner":
                        return (
                            <div key={i} className="my-2">
                                <PlannerResultCard data={part.data as PlannerResult} />
                            </div>
                        );
                    case "researcher":
                        return (
                            <div key={i} className="my-2">
                                <ResearcherResultCard data={part.data as ResearcherResult} />
                            </div>
                        );
                    case "synthesizer":
                        return (
                            <div key={i} className="my-2">
                                <SynthesizerResultCard data={part.data as SynthesizerResult} />
                            </div>
                        );
                    case "pdf_writer":
                        return (
                            <div key={i} className="my-2">
                                <PdfWriterResultCard data={part.data as PdfWriterResult} />
                            </div>
                        );
                    default:
                        return null;
                }
            })}
        </>
    );
}
