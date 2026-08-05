/**
 * A generated PDF report, opened through a link that cannot go stale.
 *
 * The tool returns a presigned URL valid for one hour. That URL lives on in the
 * chat transcript long after it dies, so clicking a report from an earlier run
 * returned S3's `AccessDenied` — which reads like a permissions fault rather
 * than an expiry, and sent the original diagnosis the wrong way.
 *
 * So the embedded URL is never used for navigation. On click the card asks
 * `GET /reports/{reportId}` for a freshly signed link and opens that, which
 * works for as long as the object exists. The embedded URL is only a fallback,
 * for reports generated before `report_id` was returned.
 */

import { useCallback, useState } from "react";
import Container from "@cloudscape-design/components/container";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { FileText } from "lucide-react";
import { useAuth } from "react-oidc-context";
import type { PdfDocumentResult } from "./types";
import { fetchReportUrl } from "@/services/reportHistoryService";

export function PdfDocumentResultCard({ data }: { data: PdfDocumentResult }): JSX.Element {
    const auth = useAuth();
    const [isOpening, setIsOpening] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const title = data.topic || data.title || data.filename || "Report";

    const open = useCallback(async (): Promise<void> => {
        setError(null);
        setIsOpening(true);
        try {
            let url =
                data.report_id && auth.user?.id_token
                    ? await fetchReportUrl(auth.user.id_token, data.report_id)
                    : null;
            // Older results carry no report_id, so the original link is all
            // there is. It may already have expired.
            url ??= data.url;
            if (!url) {
                setError("This report is no longer available.");
                return;
            }
            window.open(url, "_blank", "noopener,noreferrer");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not open the report");
        } finally {
            setIsOpening(false);
        }
    }, [auth.user?.id_token, data.report_id, data.url]);

    return (
        <Container>
            <SpaceBetween size="s">
                <div className="flex items-center gap-3">
                    <FileText size={20} className="text-green-600" />
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <StatusIndicator type="success">PDF ready</StatusIndicator>
                            <span className="font-medium truncate">{title}</span>
                        </div>
                        <Box color="text-body-secondary" fontSize="body-s">
                            {data.pages != null ? `${data.pages} pages · ` : ""}
                            {data.filename ?? "report.pdf"}
                        </Box>
                    </div>
                    <Button onClick={() => void open()} loading={isOpening} iconName="external">
                        Open report
                    </Button>
                </div>

                {error && <StatusIndicator type="error">{error}</StatusIndicator>}
            </SpaceBetween>
        </Container>
    );
}
