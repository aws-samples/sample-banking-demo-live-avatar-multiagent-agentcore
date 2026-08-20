import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { FlaskConical } from "lucide-react";

/**
 * Launch receipt for the managed Bedrock evaluation of the Services Catalog.
 *
 * The A/B is a REAL, console-visible evaluation, not an inline widget: each
 * model's descriptions were shipped to Amazon Bedrock's model-evaluation
 * service as a model-as-a-judge job scored against a custom rubric. Those jobs
 * run asynchronously (minutes), so this card is the launch confirmation — it
 * names the jobs and links out to the Bedrock console where the scorecards
 * appear once each job completes.
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

interface BedrockEvaluationLaunchCardProps {
    status?: "ok" | "error";
    judgeModel?: string;
    metric?: string;
    region?: string;
    consoleUrl?: string;
    itemCount?: number;
    message?: string;
    jobs?: EvalJob[];
}

export function BedrockEvaluationLaunchCard({
    status = "error",
    judgeModel,
    metric,
    consoleUrl,
    itemCount,
    message,
    jobs = [],
}: BedrockEvaluationLaunchCardProps): JSX.Element {
    const launched = jobs.filter((j) => j.jobArn);
    const failed = jobs.filter((j) => !j.jobArn);

    return (
        <div className="my-3">
            <Container
                header={
                    <Header
                        variant="h2"
                        description={
                            status === "ok"
                                ? `${launched.length} model-as-a-judge job${launched.length === 1 ? "" : "s"} launched on Amazon Bedrock. Scorecards appear in the console when each job completes.`
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
                        <Box variant="small" color="text-body-secondary">
                            A/B across two models over {itemCount ?? launched.length} description
                            {itemCount === 1 ? "" : "s"}
                            {judgeModel ? `, judged by ${judgeModel}` : ""}
                            {metric ? ` on the “${metric}” rubric` : ""}.
                        </Box>
                    ) : (
                        <StatusIndicator type="error">
                            {message || "Evaluation launch failed."}
                        </StatusIndicator>
                    )}

                    {launched.map((job) => (
                        <div
                            key={job.jobArn}
                            className="rounded-md p-3"
                            style={{
                                border: "1px solid var(--glass-border)",
                                background: "var(--glass-bg)",
                            }}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-2 text-sm font-semibold">
                                    <StatusIndicator type="in-progress">
                                        {job.model ?? job.role}
                                    </StatusIndicator>
                                </span>
                                {typeof job.items === "number" ? (
                                    <span
                                        className="shrink-0 text-xs"
                                        style={{ color: "var(--app-text-secondary)" }}
                                    >
                                        {job.items} item{job.items === 1 ? "" : "s"}
                                    </span>
                                ) : null}
                            </div>
                            <p
                                className="mt-1 truncate text-[11px]"
                                style={{ color: "var(--app-text-secondary)" }}
                                title={job.jobName}
                            >
                                Job: {job.jobName}
                            </p>
                            {job.consoleUrl ? (
                                <div className="mt-2">
                                    <Button
                                        variant="inline-link"
                                        iconName="external"
                                        href={job.consoleUrl}
                                        target="_blank"
                                    >
                                        View job in console
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    ))}

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
