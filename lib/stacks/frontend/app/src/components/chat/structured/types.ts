/** Agent output interfaces matching each agent's system prompt JSON schema */

export interface SubQuestion {
    id: string;
    question: string;
    priority: "high" | "medium" | "low";
    type: string;
    rationale: string;
}

export interface PlannerResult {
    research_topic: string;
    sub_questions: SubQuestion[];
    methodology?: string;
    dependencies?: string[];
    estimated_time?: string;
}

export interface KbFinding {
    content: string;
    source?: string;
    relevance?: string;
}

export interface WebFinding {
    content: string;
    source?: string;
    url?: string;
    sub_question?: string;
    relevance?: string;
}

export interface ResearcherResult {
    question: string;
    kb_findings?: KbFinding[];
    web_findings?: WebFinding[];
    cross_references?: string;
    gaps?: string;
    key_insights?: string[];
    citations?: string[];
}

export interface KeyFinding {
    theme: string;
    finding: string;
    confidence: "high" | "medium" | "low";
    sources?: string[];
}

export interface SynthesizerResult {
    topic: string;
    executive_summary: string;
    key_findings: KeyFinding[];
    supporting_evidence?: string;
    conflicts_and_uncertainties?: string;
    conclusions?: string;
    recommendations?: string[];
    citations?: string[];
}

export interface PdfWriterResult {
    status: string;
    pdf_location?: string;
    filename?: string;
    page_count?: number;
    sections_included?: string[];
    metadata?: Record<string, unknown>;
}

export interface WebsiteWriterResult {
    success?: boolean;
    /** Present on the research/website tool result. */
    url?: string;
    /**
     * The Services Catalog's website phase reports the link under this name
     * instead (see MENU_WEBSITE_WRITER_PROMPT), so the card accepts either.
     */
    website_url?: string;
    download_url?: string;
    s3_key: string;
    title?: string;
    sections?: string[];
    sections_included?: string[];
    item_count?: number;
}

/**
 * A generated PDF, as returned by the `pdf_generator` tool.
 *
 * `url` is presigned for one hour and must not be treated as durable. Use
 * `report_id` to mint a fresh link when the report is opened — see
 * PdfDocumentResultCard.
 */
export interface PdfDocumentResult {
    success: boolean;
    artifact: "pdf";
    url: string;
    report_id?: string;
    filename?: string;
    s3_key?: string;
    topic?: string;
    title?: string;
    pages?: number;
}

export type StructuredType =
    | "planner"
    | "researcher"
    | "synthesizer"
    | "pdf_writer"
    | "pdf_document"
    | "website_writer";

export type ContentPart =
    | { type: "text"; content: string }
    | {
          type: "structured";
          data:
              | PlannerResult
              | ResearcherResult
              | SynthesizerResult
              | PdfWriterResult
              | PdfDocumentResult
              | WebsiteWriterResult;
          structuredType: StructuredType;
      };
