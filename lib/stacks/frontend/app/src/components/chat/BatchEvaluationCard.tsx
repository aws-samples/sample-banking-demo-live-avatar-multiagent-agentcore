import { useCallback, useEffect, useRef, useState } from "react";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { Gauge } from "lucide-react";
import { useAuth } from "react-oidc-context";
import { fetchBatchStatus, type BatchEvalStatus } from "@/services/catalogEvalService";

/**
 * Live tracker for the AgentCore batch evaluation that auto-fires when the
 * Services Catalog is emitted.
 *
 * The evaluation is a REAL, console-visible AgentCore artifact: the custom
 * copy-quality evaluator runs over the AI Assistant's recent session traces and
 * lands per-session scores in a CloudWatch results log stream. It starts as
 * PENDING while the presenter reviews the catalog (and can show the AWS console
 * "Batch evaluation" tab), then this card polls the backend `/catalog-eval`
 * endpoint and renders the aggregate score once it completes (~1-2 min).
 */

interface BatchEvaluationCardProps {
    status?: "ok" | "error";
    batchEvaluationId?: string;
    batchStatus?: string;
    evaluator?: string;
    metric?: string;
    region?: string;
    consoleUrl?: string;
    message?: string;
}

// Poll every 15s, up to ~10 min — batch evals typically finish in ~1-2 min.
const POLL_MS = 15_000;
const MAX_POLLS = 40;

function statusLabel(s: string | undefined): string {
    switch (s) {
        case "PENDING":
            return "Pending";
        case "IN_PROGRESS":
            return "In progress";
        case "COMPLETED":
            return "Completed";
        case "COMPLETED_WITH_ERRORS":
            return "Completed (with errors)";
        case "FAILED":
            return "Failed";
        case "STOPPED":
            return "Stopped";
        case undefined:
            return "Pending";
        default:
            return s;
    }
}

export function BatchEvaluationCard({
    status = "error",
    batchEvaluationId,
    batchStatus,
    evaluator,
    metric,
    region,
    consoleUrl,
    message,
}: BatchEvaluationCardProps): JSX.Element {
    const auth = useAuth();
    const idToken = auth.user?.id_token;
    const [live, setLive] = useState<BatchEvalStatus | null>(null);
    const [done, setDone] = useState(false);
    const pollsRef = useRef(0);

    const poll = useCallback(async (): Promise<boolean> => {
        if (!idToken || !batchEvaluationId) return true;
        try {
            const resp = await fetchBatchStatus(batchEvaluationId, idToken);
            setLive(resp);
            if (resp.done) setDone(true);
            return resp.done;
        } catch {
            return false; // transient; keep polling
        }
    }, [idToken, batchEvaluationId]);

    useEffect(() => {
        if (status !== "ok" || !batchEvaluationId || done) return;
        pollsRef.current = 0;
        void poll();
        const timer = setInterval(() => {
            pollsRef.current += 1;
            if (pollsRef.current > MAX_POLLS) {
                clearInterval(timer);
                return;
            }
            void poll().then((finished) => {
                if (finished) clearInterval(timer);
            });
        }, POLL_MS);
        return () => clearInterval(timer);
    }, [status, batchEvaluationId, done, poll]);

    const currentStatus = live?.status ?? batchStatus;
    const completed = currentStatus === "COMPLETED" || currentStatus === "COMPLETED_WITH_ERRORS";
    const failed = currentStatus === "FAILED" || currentStatus === "Error";
    const score = live?.score;

    const band = (s: number): string => (s >= 85 ? "#37b24d" : s >= 70 ? "#e0b850" : "#f03e3e");

    return (
        <div className="my-3">
            <Container
                header={
                    <Header
                        variant="h2"
                        description={
                            status === "ok"
                                ? completed
                                    ? "Evaluation complete — aggregate score below, full run in the AgentCore console."
                                    : "Scoring the AI Assistant's recent sessions on AgentCore. Tracking live…"
                                : "The batch evaluation could not be launched."
                        }
                        actions={
                            consoleUrl ? (
                                <Button
                                    iconName="external"
                                    href={consoleUrl}
                                    target="_blank"
                                    ariaLabel="Open AgentCore evaluations in the AWS console"
                                >
                                    Open in AgentCore console
                                </Button>
                            ) : undefined
                        }
                    >
                        <span className="flex items-center gap-2">
                            <Gauge size={16} /> AgentCore Batch Evaluation
                        </span>
                    </Header>
                }
            >
                <SpaceBetween size="m">
                    {status === "ok" ? (
                        <>
                            <Box variant="small" color="text-body-secondary">
                                Custom evaluator
                                {evaluator ? ` “${evaluator}”` : ""} over recent AI Assistant
                                sessions
                                {metric ? ` on the “${metric}” rubric` : ""}. Per-session scores
                                land in AgentCore Observability
                                {region ? ` (${region})` : ""}.
                            </Box>

                            <div
                                className="rounded-md p-3"
                                style={{
                                    border: completed
                                        ? "1px solid #37b24d66"
                                        : "1px solid var(--glass-border)",
                                    background: completed ? "#37b24d0d" : "var(--glass-bg)",
                                }}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="flex items-center gap-2 text-sm font-semibold">
                                        <StatusIndicator
                                            type={
                                                failed ? "error" : completed ? "success" : "loading"
                                            }
                                        >
                                            {statusLabel(currentStatus)}
                                        </StatusIndicator>
                                    </span>
                                    {completed && typeof score === "number" ? (
                                        <span
                                            className="text-lg font-semibold"
                                            style={{ color: band(score) }}
                                        >
                                            {score}
                                            <span
                                                className="ml-0.5 text-[9.5px] font-normal"
                                                style={{ color: "var(--app-text-secondary)" }}
                                            >
                                                /100
                                            </span>
                                        </span>
                                    ) : null}
                                </div>
                                {completed && typeof live?.count === "number" ? (
                                    <p
                                        className="mt-1 text-[11px]"
                                        style={{ color: "var(--app-text-secondary)" }}
                                    >
                                        {live.count} session score{live.count === 1 ? "" : "s"}{" "}
                                        aggregated.
                                    </p>
                                ) : null}
                                {completed && live?.explanation ? (
                                    <p
                                        className="mt-1 text-[11px] italic"
                                        style={{ color: "var(--app-text-secondary)" }}
                                    >
                                        “{live.explanation}”
                                    </p>
                                ) : null}
                                {completed && typeof score !== "number" ? (
                                    <p
                                        className="mt-1 text-[11px]"
                                        style={{ color: "var(--app-text-secondary)" }}
                                    >
                                        {/* The status Lambda explains *why* nothing scored —
                                            usually that spans had not reached CloudWatch yet.
                                            Falling back to the generic line only when it is
                                            absent avoids the old, misleading "still being
                                            written" message on a job that had zero sessions. */}
                                        {live?.note ??
                                            "Scores are still being written — check the AgentCore console for the full run."}
                                    </p>
                                ) : null}
                            </div>

                            {batchEvaluationId ? (
                                <Box variant="small" color="text-body-secondary">
                                    Batch ID: <code>{batchEvaluationId}</code>
                                </Box>
                            ) : null}
                        </>
                    ) : (
                        <StatusIndicator type="error">
                            {message || "Batch evaluation launch failed."}
                        </StatusIndicator>
                    )}
                </SpaceBetween>
            </Container>
        </div>
    );
}
