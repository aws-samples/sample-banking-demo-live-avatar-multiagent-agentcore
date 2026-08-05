/**
 * A single download link, emitted once a run finishes.
 *
 * The viewer appears as soon as the PDF exists, which puts it above the closing
 * summary and often well out of view by the time the run ends — finishing a run
 * meant scrolling back to find the report. The agent's own closing text names
 * the file but cannot link it, because a presigned URL pasted into prose expires
 * while the message is kept.
 *
 * So this is deliberately one line rather than a second viewer: the report is
 * already rendered above, and duplicating it would just add clutter.
 */

import { useCallback, useState } from "react";
import Button from "@cloudscape-design/components/button";
import Box from "@cloudscape-design/components/box";
import { FileText } from "lucide-react";
import { useAuth } from "react-oidc-context";
import { fetchReportUrl } from "@/services/reportHistoryService";

interface PdfDownloadLinkProps {
    url: string;
    report_id?: string;
    filename?: string;
}

export function PdfDownloadLinkCard({
    url,
    report_id: reportId,
    filename,
}: PdfDownloadLinkProps): JSX.Element {
    const auth = useAuth();
    const idToken = auth.user?.id_token;
    const [busy, setBusy] = useState(false);

    const download = useCallback((): void => {
        setBusy(true);
        void (async () => {
            let target = url;
            if (reportId && idToken) {
                try {
                    // Signed for download, and freshly, so the link works however
                    // long after the run it is pressed.
                    target = (await fetchReportUrl(idToken, reportId, "attachment")) ?? url;
                } catch {
                    // Fall through to the original link rather than doing nothing.
                }
            }
            window.open(target, "_blank", "noopener,noreferrer");
            setBusy(false);
        })();
    }, [reportId, idToken, url]);

    return (
        <div
            className="my-2 flex items-center gap-3 rounded-lg px-3 py-2"
            style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)" }}
        >
            <FileText size={16} className="text-green-600 flex-none" />
            <Box variant="p" fontSize="body-s">
                {filename || "Report"}
            </Box>
            <div className="ml-auto">
                <Button onClick={download} loading={busy} iconName="download" variant="primary">
                    Download report
                </Button>
            </div>
        </div>
    );
}
