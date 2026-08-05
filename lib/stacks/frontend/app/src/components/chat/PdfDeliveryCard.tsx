/**
 * The report the research pipeline just produced.
 *
 * The orchestrator emits the PDF straight to the UI rather than letting the
 * model relay it, so this is the main way a report is opened. The URL it sends
 * is presigned for one hour, which is fine on the turn it arrives and wrong
 * every time afterwards: the card remounts whenever the conversation is
 * revisited, and the stale link rendered S3's AccessDenied XML inside the
 * viewer's iframe.
 *
 * So the URL from the payload is treated as a first-load convenience only. When
 * a `report_id` is present the card asks `GET /reports/{reportId}` for a fresh
 * link on every mount, which keeps working for as long as the object exists.
 */

import { useCallback, useEffect, useState } from "react";
import Container from "@cloudscape-design/components/container";
import Spinner from "@cloudscape-design/components/spinner";
import { useAuth } from "react-oidc-context";
import PdfViewer from "@/components/viewer/PdfViewer";
import { fetchReportUrl } from "@/services/reportHistoryService";

interface PdfDeliveryProps {
    url: string;
    s3_key?: string;
    report_id?: string;
    filename?: string;
}

export function PdfDeliveryCard({
    url,
    report_id: reportId,
    filename,
}: PdfDeliveryProps): JSX.Element {
    const auth = useAuth();
    const idToken = auth.user?.id_token;
    const title = filename || "Report";

    const [freshUrl, setFreshUrl] = useState<string | null>(null);

    // Without a report_id there is nothing to re-sign against: the report
    // predates the id being returned, so the original link is all there is.
    const canRefresh = Boolean(reportId && idToken);
    // Derived rather than assigned in the effect, so the no-refresh case needs
    // no state write at all.
    const displayUrl = freshUrl ?? (canRefresh ? null : url);

    useEffect(() => {
        if (!reportId || !idToken) return;

        let cancelled = false;
        void (async () => {
            let fresh: string | null = null;
            try {
                fresh = await fetchReportUrl(idToken, reportId);
            } catch {
                // Transient failure; the original link may still be inside its hour.
            }
            // A 404 means history has no record of this run, which is NOT the
            // same as the object being gone — it was reported as "no longer
            // stored" for a report that was sitting in the bucket, because the
            // run record had been skipped. Fall back to the link we were given
            // rather than telling the user something untrue about their file.
            if (!cancelled) setFreshUrl(fresh ?? url);
        })();

        return () => {
            cancelled = true;
        };
    }, [reportId, idToken, url]);

    /**
     * Save the report rather than display it.
     *
     * A separate link signed with `attachment` disposition — the one driving the
     * iframe is signed `inline`, so navigating to it would only show the PDF
     * again. Falls back to opening in a new tab when the report has no id to
     * re-sign against, which at least never replaces the app.
     */
    const download = useCallback((): void => {
        void (async () => {
            let target = url;
            if (reportId && idToken) {
                try {
                    target = (await fetchReportUrl(idToken, reportId, "attachment")) ?? url;
                } catch {
                    // Fall through to the inline link; opening beats doing nothing.
                }
            }
            window.open(target, "_blank", "noopener,noreferrer");
        })();
    }, [reportId, idToken, url]);

    if (!displayUrl) {
        return (
            <Container>
                <div className="flex items-center gap-2 py-6 justify-center">
                    <Spinner /> <span>Preparing {title}…</span>
                </div>
            </Container>
        );
    }

    return <PdfViewer url={displayUrl} title={title} onDownload={download} />;
}
