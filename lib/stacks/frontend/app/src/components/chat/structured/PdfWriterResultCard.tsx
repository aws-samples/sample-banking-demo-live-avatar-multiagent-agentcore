import Container from "@cloudscape-design/components/container";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import Badge from "@cloudscape-design/components/badge";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { FileText } from "lucide-react";
import type { PdfWriterResult } from "./types";
import { safe, safeArray } from "./safe-render";

export function PdfWriterResultCard({ data }: { data: PdfWriterResult }): JSX.Element {
    const statusStr = safe(data.status);
    const isSuccess =
        statusStr.toLowerCase() === "success" || statusStr.toLowerCase() === "complete";

    return (
        <Container>
            <SpaceBetween size="s">
                <div className="flex items-center gap-3">
                    <FileText size={20} className={isSuccess ? "text-green-600" : "text-red-500"} />
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <StatusIndicator type={isSuccess ? "success" : "error"}>
                                {statusStr}
                            </StatusIndicator>
                            {data.filename && (
                                <span className="font-mono text-sm">{safe(data.filename)}</span>
                            )}
                        </div>
                        {data.page_count != null && (
                            <Box color="text-body-secondary" fontSize="body-s">
                                {data.page_count} pages
                            </Box>
                        )}
                    </div>
                </div>

                {/* Sections included */}
                {safeArray(data.sections_included).length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                        {safeArray(data.sections_included).map((s, i) => (
                            <Badge key={i} color="blue">
                                {s}
                            </Badge>
                        ))}
                    </div>
                )}
            </SpaceBetween>
        </Container>
    );
}
