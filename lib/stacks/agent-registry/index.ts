import { CfnOutput, CustomResource, Duration, StackProps } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
    Architecture,
    Code,
    Function as LambdaFunction,
    Runtime as LambdaRuntime,
} from "aws-cdk-lib/aws-lambda";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Provider } from "aws-cdk-lib/custom-resources";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";
import { Stack } from "../../common/constructs/stack";
import { getStackNameBase } from "../../common/feature-flags";

/** One advertised A2A skill, mirroring the agent-card modules under patterns/. */
export interface AgentRegistrySkill {
    id: string;
    name: string;
    description: string;
    tags: string[];
}

/**
 * One A2A agent to publish as an APPROVED registry record. The runtime
 * invocation URL is derived at deploy time from the runtime ARN held in the
 * given SSM parameter (published by the Backend stack), so the ARN does not need
 * to be threaded across stacks as a CloudFormation cross-stack reference.
 */
export interface AgentRegistryAgent {
    /** Human-friendly source name; sanitized to `[a-zA-Z0-9]` for the record name. */
    recordName: string;
    /** Console display name (may contain spaces). */
    displayName: string;
    /** Agent-card `name` (identity). */
    name: string;
    /** Agent-card `description`. */
    description: string;
    /** Agent-card `version`. */
    version: string;
    /** Advertised A2A skills. */
    skills: AgentRegistrySkill[];
    /** SSM parameter name holding the agent's AgentCore runtime ARN. */
    runtimeArnParam: string;
    /**
     * Registry record type. "AGENT" (default) publishes an A2A agent card and
     * must only be used for genuine A2A callees. "CUSTOM" publishes free-form
     * capability + invocation metadata — the honest type for runtimes that are
     * invocable over the AgentCore HTTP protocol rather than A2A (e.g. the
     * Deep Research pipeline), so the catalog never advertises an A2A endpoint
     * that does not exist.
     */
    recordType?: "AGENT" | "CUSTOM";
    /**
     * For CUSTOM records: the request contract another team sends the runtime
     * (e.g. { mode: "research", prompt: "<brief>" }). Included verbatim in the
     * record's invocation metadata.
     */
    payloadContract?: Record<string, unknown>;
    /**
     * For CUSTOM records: the in-process phases the pipeline runs (e.g.
     * planner → researcher → synthesizer → evaluator), so a search for
     * "planner" or "synthesis" still discovers the pipeline that contains it.
     */
    phases?: string[];
}

export interface AgentRegistryProps extends StackProps {
    /** Agents to register. When empty, only the (empty) registry is created. */
    agents: AgentRegistryAgent[];
}

/**
 * Flag-gated AWS Agent Registry (preview) publisher.
 *
 * The AWS Agent Registry has no CloudFormation resource, so a Lambda-backed
 * custom resource (see `patterns/agent-registry-cr/handler.py`) creates the
 * registry and publishes APPROVED AGENT records via the preview
 * `agent-registry-control` API during `cdk deploy`, and best-effort tears them
 * down during `cdk destroy`. The resulting registry id is written to
 * `/{stackName}/agent_registry_id`.
 */
export class AgentRegistry extends Stack {
    public readonly registryArn: string;

    constructor(scope: Construct, id: string, props: AgentRegistryProps) {
        super(scope, id, props);

        const { agents } = props;
        const stackName = getStackNameBase(this.node);
        const repoRoot = path.resolve(__dirname, "..", "..", "..");

        // Registry name must be `[a-zA-Z0-9]+` (max 64); the handler sanitizes
        // again defensively, but keep the CDK-side value valid too.
        const registryName = stackName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 64);

        // Resolve each agent's runtime ARN from the SSM parameter the Backend
        // stack publishes, then build the Agents payload. Tokens embedded in the
        // JSON string resolve at deploy time.
        const agentsPayload = agents.map((agent) => ({
            recordName: agent.recordName,
            displayName: agent.displayName,
            name: agent.name,
            description: agent.description,
            version: agent.version,
            skills: agent.skills,
            runtimeArn: StringParameter.valueForStringParameter(this, agent.runtimeArnParam),
            ...(agent.recordType ? { recordType: agent.recordType } : {}),
            ...(agent.payloadContract ? { payloadContract: agent.payloadContract } : {}),
            ...(agent.phases ? { phases: agent.phases } : {}),
        }));
        const agentsJson = JSON.stringify(agentsPayload);

        // Custom-resource handler. Bundles a recent boto3 (>= 1.43.74) because
        // the `agent-registry-control` client does not exist in the Lambda
        // runtime's built-in SDK. boto3/botocore are pure-Python, so the bundle
        // is architecture-independent. Timeout is generous: create_registry is
        // async and can take a couple of minutes to reach READY.
        const provisionerFn = new LambdaFunction(this, "AgentRegistryProvisioner", {
            functionName: `${stackName}-agent-registry-provisioner`,
            runtime: LambdaRuntime.PYTHON_3_13,
            architecture: Architecture.ARM_64,
            handler: "handler.on_event",
            timeout: Duration.minutes(10),
            memorySize: 256,
            code: Code.fromAsset(path.join(repoRoot, "patterns", "agent-registry-cr"), {
                exclude: ["__pycache__", "*.pyc"],
                bundling: {
                    image: LambdaRuntime.PYTHON_3_13.bundlingImage,
                    command: [
                        "bash",
                        "-c",
                        "pip install -r requirements.txt -t /asset-output && cp -au . /asset-output",
                    ],
                },
            }),
        });

        // The preview Agent Registry control-plane actions. Resource is "*" — the
        // registry/record ARNs are created at runtime by this very resource.
        provisionerFn.addToRolePolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "agent-registry-control:CreateRegistry",
                    "agent-registry-control:GetRegistry",
                    "agent-registry-control:ListRegistries",
                    "agent-registry-control:DeleteRegistry",
                    "agent-registry-control:CreateRegistryRecord",
                    "agent-registry-control:GetRegistryRecord",
                    "agent-registry-control:ListRegistryRecords",
                    "agent-registry-control:DeleteRegistryRecord",
                    "agent-registry-control:SubmitRegistryRecordForApproval",
                    "agent-registry-control:UpdateRegistryRecordStatus",
                    // Read side of the data-plane, for good measure.
                    "agent-registry:*",
                    // Registry create/delete provisions an AgentCore workload
                    // identity on the caller's behalf; without these the
                    // registry lands in CREATE_FAILED ("Unable to create
                    // workload identity because access was denied"). GetWorkload
                    // Identity is required for idempotent CreateRegistry retries.
                    "bedrock-agentcore:CreateWorkloadIdentity",
                    "bedrock-agentcore:GetWorkloadIdentity",
                    "bedrock-agentcore:DeleteWorkloadIdentity",
                ],
                resources: ["*"],
            })
        );

        const provider = new Provider(this, "AgentRegistryProvider", {
            onEventHandler: provisionerFn,
        });

        const resource = new CustomResource(this, "AgentRegistryResource", {
            serviceToken: provider.serviceToken,
            properties: {
                RegistryName: registryName,
                RegistryDescription: `Agent registry for ${stackName}`,
                // The Agents payload changes whenever an identity/skill/runtime
                // input changes, which makes the Provider re-run on Update.
                Agents: agentsJson,
            },
        });

        this.registryArn = resource.getAttString("RegistryArn");

        // Publish the registry id so other tooling can resolve it.
        new StringParameter(this, "AgentRegistryIdParam", {
            parameterName: `/${stackName}/agent_registry_id`,
            stringValue: resource.getAttString("RegistryId"),
        });

        new CfnOutput(this, "AgentRegistryArn_Output", {
            value: this.registryArn,
            description:
                "AWS Agent Registry ARN/id; empty if the preview API was unavailable at deploy",
        });

        // The provisioner needs the preview actions on "*" (registry/record ARNs
        // are created at runtime); the Provider framework brings its own
        // managed-runtime Lambda + role.
        NagSuppressions.addResourceSuppressions(
            provisionerFn,
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "Agent Registry provisioner needs agent-registry-control:* / agent-registry:* on * because the registry and record ARNs are created at runtime by this custom resource.",
                },
            ],
            true
        );
        NagSuppressions.addResourceSuppressions(
            provider,
            [
                {
                    id: "AwsSolutions-IAM4",
                    reason: "CDK Provider framework Lambda uses the managed basic-execution role.",
                },
                {
                    id: "AwsSolutions-IAM5",
                    reason: "CDK Provider framework grants wildcard invoke on its own onEvent handler.",
                },
                {
                    id: "AwsSolutions-L1",
                    reason: "CDK Provider framework manages its own Lambda runtime version.",
                },
            ],
            true
        );
    }
}
