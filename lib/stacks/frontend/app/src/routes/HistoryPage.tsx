/**
 * Run history — every completed report, reopenable.
 *
 * Links are signed server-side on each load rather than stored, so a report from
 * last week opens exactly like one from a minute ago. Storing the URL is what
 * previously produced S3 AccessDenied after an hour.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "react-oidc-context";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Spinner from "@cloudscape-design/components/spinner";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Badge from "@cloudscape-design/components/badge";
import { FileText, RefreshCw } from "lucide-react";
import {
    fetchReportHistory,
    isReportHistoryAvailable,
    type ReportHistoryItem,
} from "@/services/reportHistoryService";

const PIPELINE_LABELS: Record<string, string> = {
    strategy_research: "Market Strategy",
    market_research: "Market Intelligence",
    services: "Services Catalog",
};

function formatWhen(iso: string): string {
    if (!iso) return "Unknown date";
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? iso
        : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatSize(bytes: number): string {
    if (!bytes) return "";
    return bytes >= 1_000_000
        ? `${(bytes / 1_000_000).toFixed(1)} MB`
        : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export default function HistoryPage(): JSX.Element {
    const auth = useAuth();
    const [reports, setReports] = useState<ReportHistoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (): Promise<void> => {
        const idToken = auth.user?.id_token;
        if (!idToken) {
            setError("Sign-in required to view run history.");
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setReports(await fetchReportHistory(idToken));
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not load run history");
        } finally {
            setLoading(false);
        }
    }, [auth.user?.id_token]);

    useEffect(() => {
        void load();
    }, [load]);

    if (!isReportHistoryAvailable()) {
        return (
            <Box padding="l">
                <Alert type="info" header="Run history is not configured">
                    The reports endpoint is unavailable. Deploy the backend stack so
                    VITE_FEEDBACK_API_URL is set.
                </Alert>
            </Box>
        );
    }

    return (
        <Box padding="l">
            <SpaceBetween size="m">
                <Header
                    variant="h1"
                    description="Every completed run. Links are re-signed each time this page loads, so older reports keep opening."
                    actions={
                        <Button
                            iconSvg={<RefreshCw size={16} />}
                            onClick={() => void load()}
                            disabled={loading}
                        >
                            Refresh
                        </Button>
                    }
                >
                    Run History
                </Header>

                {error && (
                    <Alert type="error" header="Could not load run history">
                        {error}
                    </Alert>
                )}

                {loading && (
                    <Box textAlign="center" padding="xl">
                        <Spinner size="large" />
                        <Box variant="p" color="text-body-secondary" padding={{ top: "s" }}>
                            Loading runs…
                        </Box>
                    </Box>
                )}

                {!loading && !error && reports.length === 0 && (
                    <Alert type="info" header="No runs yet">
                        Completed research and catalog runs will appear here once they generate a
                        report.
                    </Alert>
                )}

                {!loading &&
                    reports.map((r) => (
                        <Container
                            key={r.reportId}
                            header={
                                <Header
                                    variant="h3"
                                    description={`${formatWhen(r.createdAt)}${
                                        r.sizeBytes ? ` · ${formatSize(r.sizeBytes)}` : ""
                                    }`}
                                    actions={
                                        r.url ? (
                                            <Button
                                                variant="primary"
                                                href={r.url}
                                                target="_blank"
                                                iconSvg={<FileText size={16} />}
                                            >
                                                Open PDF
                                            </Button>
                                        ) : (
                                            <Badge color="red">Unavailable</Badge>
                                        )
                                    }
                                >
                                    {r.title}
                                </Header>
                            }
                        >
                            <SpaceBetween direction="horizontal" size="xs">
                                {r.pipeline && (
                                    <Badge color="blue">
                                        {PIPELINE_LABELS[r.pipeline] ?? r.pipeline}
                                    </Badge>
                                )}
                                {r.mode && <Badge color="grey">{r.mode}</Badge>}
                            </SpaceBetween>
                        </Container>
                    ))}
            </SpaceBetween>
        </Box>
    );
}
