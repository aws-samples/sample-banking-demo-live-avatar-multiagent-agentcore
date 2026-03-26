import PdfViewer from "@/components/viewer/PdfViewer";

interface PdfDeliveryProps {
    url: string;
    s3_key?: string;
    filename?: string;
}

/** Renders a PDF from a presigned URL emitted directly by the orchestrator. */
export function PdfDeliveryCard({ url, filename }: PdfDeliveryProps): JSX.Element {
    const title = filename || "Report";
    return <PdfViewer url={url} title={title} />;
}
