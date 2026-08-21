import { useCallback, useEffect, useRef, useState } from "react";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import { FlaskConical, Check } from "lucide-react";
import { useAuth } from "react-oidc-context";
import { fetchEvalStatus, type EvalJobStatus } from "@/services/catalogEvalService";

/**
 * Launch receipt + live tracker for the managed Bedrock evaluation of the
 * Services Catalog.
 *
 * The A/B is a REAL, console-visible evaluation: each model's descriptions were
 * shipped to Amazon Bedrock's model-evaluation service as a model-as-a-judge
 * job scored against a custom rubric. Those jobs run asynchronously (minutes),
 * so this card polls the backend `/catalog-eval` endpoint to show live status
 * per job and renders the copy-quality score — and the winning model — once the
 * jobs complete. It also links out to the Bedrock console.
 */

interface EvalJob {
    role?: string;
    model?: string;
    jobName?: string;
    jobArn?: string;
    items?: number;
    consoleUrl?: string;
    status?: string;
    message?: string;
}

interface EvalVariant {
    role?: string;
    model?: string;
    sections?: { name?: string; items?: Record<string, unknown>[] }[];
}

interface BedrockEvaluationLaunchCardProps {
    status?: "ok" | "error";
    judgeModel?: string;
    metric?: string;
    region?: string;
    consoleUrl?: string;
    itemCount?: number;
    message?: string;
    jobs?: EvalJob[];
    /** Both models' full catalog copy, so the winner can be applied as the app's catalog. */
    variants?: EvalVariant[];
    onAction?: (action: string, data: unknown) => void;
}

// Poll every 20s, up to ~25 min — model-eval jobs typically finish in a few
// minutes but can run longer.
const POLL_MS = 20_000;
const MAX_POLLS = 75;

function statusLabel(s: string | undefined): string {
    switch (s) {
        case "InProgress":
            return "In progress";
        case "Completed":
            return "Completed";
        case "Failed":
            return "Failed";
        case "Stopped":
            return "Stopped";
        case undefined:
            return "Queued";
        default:
            return s;
    }
}

function scoreBand(score: number): string {
    return score >= 85 ? "#37b24d" : score >= 70 ? "#e0b850" : "#f03e3e";
}

/**
 * Per-variant explainer: how the score was reached. Shows the rubric
 * dimensions the judge scored against, each item's score + the judge's
 * reasoning, and a nested "raw JSON" sub-section with the verbatim
 * evaluation-output records.
 */
function EvalReasoning({ job }: { job: EvalJobStatus }): JSX.Element | null {
    const items = job.items ?? [];
    const raw = job.raw ?? [];
    if (items.length === 0 && raw.length === 0) return null;
    return (
        <ExpandableSection
            headerText="Why this score — judge reasoning"
            variant="footer"
            headerDescription={
                job.dimensions && job.dimensions.length > 0
                    ? `Scored on: ${job.dimensions.join(" · ")}`
                    : undefined
            }
        >
            <SpaceBetween size="s">
                <Box variant="small" color="text-body-secondary">
                    {typeof job.count === "number"
                        ? `${job.count} item${job.count === 1 ? "" : "s"} judged`
                        : ""}
                    {typeof job.passRate === "number" ? ` · ${job.passRate}% rated excellent` : ""}
                    {job.jobName ? ` · job ${job.jobName}` : ""}
                </Box>

                {items.map((it, i) => (
                    <div
                        key={i}
                        className="rounded-md p-2"
                        style={{
                            border: "1px solid var(--glass-border)",
                            background: "var(--glass-bg)",
                        }}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold" title={it.product}>
                                {it.product || `Item ${i + 1}`}
                            </span>
                            {typeof it.score === "number" ? (
                                <span
                                    className="shrink-0 text-sm font-semibold"
                                    style={{ color: scoreBand(it.score) }}
                                >
                                    {it.score}
                                    <span className="ml-0.5 text-[9px] font-normal opacity-70">
                                        /100
                                    </span>
                                </span>
                            ) : null}
                        </div>
                        {it.response ? (
                            <p
                                className="mt-1 text-[11px] italic"
                                style={{ color: "var(--app-text-secondary)" }}
                            >
                                “{it.response}”
                            </p>
                        ) : null}
                        {it.reasoning ? (
                            <p className="mt-1 text-[11px]" style={{ color: "var(--app-text)" }}>
                                {it.reasoning}
                            </p>
                        ) : null}
                    </div>
                ))}

                {raw.length > 0 && (
                    <ExpandableSection headerText="Raw evaluation output (JSON)" variant="footer">
                        <pre
                            className="overflow-auto rounded-md p-2 text-[10px] leading-snug"
                            style={{
                                maxHeight: 320,
                                border: "1px solid var(--glass-border)",
                                background: "var(--glass-bg)",
                                color: "var(--app-text)",
                            }}
                        >
                            {JSON.stringify(raw, null, 2)}
                        </pre>
                    </ExpandableSection>
                )}
            </SpaceBetween>
        </ExpandableSection>
    );
}

export function BedrockEvaluationLaunchCard({
    status = "error",
    judgeModel,
    metric,
    region,
    consoleUrl,
    itemCount,
    message,
    jobs = [],
    variants = [],
    onAction,
}: BedrockEvaluationLaunchCardProps): JSX.Element {
    const auth = useAuth();
    const idToken = auth.user?.id_token;
    const [applied, setApplied] = useState<string | null>(null);
    const launched = jobs.filter((j) => j.jobArn);
    const failed = jobs.filter((j) => !j.jobArn);
    const launchedArns = launched.map((j) => j.jobArn as string);
    const arnsKey = launchedArns.join(",");

    const [live, setLive] = useState<Record<string, EvalJobStatus>>({});
    const [allDone, setAllDone] = useState(false);
    const pollsRef = useRef(0);

    const poll = useCallback(async (): Promise<boolean> => {
        if (!idToken || launchedArns.length === 0) return true;
        try {
            const resp = await fetchEvalStatus(launchedArns, idToken);
            const map: Record<string, EvalJobStatus> = {};
            for (const j of resp.jobs) map[j.jobArn] = j;
            setLive(map);
            if (resp.allDone) setAllDone(true);
            return resp.allDone;
        } catch {
            return false; // transient; keep polling
        }
        // arnsKey stands in for launchedArns (stable string) to satisfy deps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idToken, arnsKey]);

    useEffect(() => {
        if (status !== "ok" || launchedArns.length === 0 || allDone) return;
        pollsRef.current = 0;
        let timer: ReturnType<typeof setInterval> | undefined;
        // Kick off immediately, then on an interval until done or capped.
        void poll();
        timer = setInterval(() => {
            pollsRef.current += 1;
            if (pollsRef.current > MAX_POLLS) {
                if (timer) clearInterval(timer);
                return;
            }
            void poll().then((done) => {
                if (done && timer) clearInterval(timer);
            });
        }, POLL_MS);
        return () => {
            if (timer) clearInterval(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, arnsKey, allDone, poll]);

    // Determine the winner once everything with a score is done.
    const scored = launched
        .map((j) => ({ job: j, s: live[j.jobArn as string] }))
        .filter((x) => x.s && typeof x.s.score === "number");
    const winnerArn =
        allDone && scored.length > 1
            ? scored.reduce((a, b) => ((b.s.score as number) > (a.s.score as number) ? b : a)).job
                  .jobArn
            : undefined;
    const winnerModel = launched.find((j) => j.jobArn === winnerArn)?.model;

    const applyVariant = (v: EvalVariant): void => {
        setApplied(v.model ?? v.role ?? "selected");
        onAction?.("apply_catalog_variant", { model: v.model, sections: v.sections });
    };

    const band = scoreBand;

    return (
        <div className="my-3">
            <Container
                header={
                    <Header
                        variant="h2"
                        description={
                            status === "ok"
                                ? allDone
                                    ? "Evaluation complete — scores below, and full scorecards in the Bedrock console."
                                    : `${launched.length} model-as-a-judge job${launched.length === 1 ? "" : "s"} running on Amazon Bedrock. Tracking live…`
                                : "The managed evaluation could not be launched."
                        }
                        actions={
                            consoleUrl ? (
                                <Button
                                    iconName="external"
                                    href={consoleUrl}
                                    target="_blank"
                                    ariaLabel="Open Bedrock evaluations in the AWS console"
                                >
                                    Open in Bedrock console
                                </Button>
                            ) : undefined
                        }
                    >
                        <span className="flex items-center gap-2">
                            <FlaskConical size={16} /> Bedrock Model Evaluation
                        </span>
                    </Header>
                }
            >
                <SpaceBetween size="m">
                    {status === "ok" ? (
                        <>
                            <Box variant="small" color="text-body-secondary">
                                A/B across two models over {itemCount ?? launched.length}{" "}
                                description
                                {itemCount === 1 ? "" : "s"}
                                {judgeModel ? `, judged by ${judgeModel}` : ""}
                                {metric ? ` on the “${metric}” rubric` : ""}.
                            </Box>
                            <Box variant="small" color="text-body-secondary">
                                Full scorecards live in the AWS console →{" "}
                                <em>Inference and assessment → Evaluations → Model evaluations</em>
                                {region ? ` (${region})` : ""}.
                            </Box>
                        </>
                    ) : (
                        <StatusIndicator type="error">
                            {message || "Evaluation launch failed."}
                        </StatusIndicator>
                    )}

                    {launched.map((job) => {
                        const s = live[job.jobArn as string];
                        const isWinner = winnerArn && job.jobArn === winnerArn;
                        const done = s?.done;
                        const completed = s?.status === "Completed";
                        const jobFailed = s?.status === "Failed";
                        return (
                            <div
                                key={job.jobArn}
                                className="rounded-md p-3"
                                style={{
                                    border: isWinner
                                        ? "1px solid #37b24d66"
                                        : "1px solid var(--glass-border)",
                                    background: isWinner ? "#37b24d0d" : "var(--glass-bg)",
                                }}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="flex items-center gap-2 text-sm font-semibold">
                                        <StatusIndicator
                                            type={
                                                jobFailed
                                                    ? "error"
                                                    : completed
                                                      ? "success"
                                                      : "loading"
                                            }
                                        >
                                            {job.model ?? job.role}
                                        </StatusIndicator>
                                        {isWinner ? (
                                            <span className="flex items-center gap-1 text-[10px] text-emerald-500">
                                                <Check size={11} /> winner
                                            </span>
                                        ) : null}
                                    </span>
                                    {completed && typeof s?.score === "number" ? (
                                        <span
                                            className="text-lg font-semibold"
                                            style={{ color: band(s.score) }}
                                        >
                                            {s.score}
                                            <span
                                                className="ml-0.5 text-[9.5px] font-normal"
                                                style={{ color: "var(--app-text-secondary)" }}
                                            >
                                                /100
                                            </span>
                                        </span>
                                    ) : (
                                        <span
                                            className="shrink-0 text-xs"
                                            style={{ color: "var(--app-text-secondary)" }}
                                        >
                                            {statusLabel(s?.status)}
                                            {!done && "…"}
                                        </span>
                                    )}
                                </div>
                                <p
                                    className="mt-1 truncate text-[11px]"
                                    style={{ color: "var(--app-text-secondary)" }}
                                    title={job.jobName}
                                >
                                    Job name: {job.jobName}
                                    {typeof job.items === "number"
                                        ? ` · ${job.items} item${job.items === 1 ? "" : "s"}`
                                        : ""}
                                </p>
                                {jobFailed && s?.failure ? (
                                    <p className="mt-1 text-[10px]" style={{ color: "#f03e3e" }}>
                                        {s.failure}
                                    </p>
                                ) : null}
                                {completed && s ? (
                                    <div className="mt-2">
                                        <EvalReasoning job={s} />
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}

                    {/* Once both jobs finish, let the user make the winning
                        model's copy the catalog the app actually uses. */}
                    {allDone && variants.length > 0 && (
                        <div
                            className="rounded-md p-3"
                            style={{
                                border: "1px solid var(--glass-border)",
                                background: "var(--glass-bg)",
                            }}
                        >
                            {applied ? (
                                <StatusIndicator type="success">
                                    Applied {applied}&apos;s copy — it&apos;s now the catalog the
                                    app uses.
                                </StatusIndicator>
                            ) : (
                                <>
                                    <Box variant="small" color="text-body-secondary">
                                        Choose which model&apos;s copy the app should use. The
                                        winner is recommended; your pick becomes the live catalog.
                                    </Box>
                                    <div className="mt-2">
                                        <SpaceBetween direction="horizontal" size="xs">
                                            {variants.map((v) => {
                                                const isWin =
                                                    winnerModel !== undefined &&
                                                    v.model === winnerModel;
                                                return (
                                                    <Button
                                                        key={v.role ?? v.model}
                                                        variant={isWin ? "primary" : "normal"}
                                                        onClick={() => applyVariant(v)}
                                                    >
                                                        Use {v.model}
                                                        {isWin ? " (winner)" : ""}
                                                    </Button>
                                                );
                                            })}
                                        </SpaceBetween>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {failed.map((job, i) => (
                        <StatusIndicator key={`f-${i}`} type="warning">
                            {job.model ?? job.role ?? "A job"}: {job.message || "failed to launch"}
                        </StatusIndicator>
                    ))}
                </SpaceBetween>
            </Container>
        </div>
    );
}
