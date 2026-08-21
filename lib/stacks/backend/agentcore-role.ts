import { Aws } from "aws-cdk-lib";
import {
    Effect,
    CompositePrincipal,
    PolicyStatement,
    Role,
    ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface AgentCoreRoleProps {
    sessionsTableArn: string;
    customersTableArn: string;
    metadataTableArn: string;
    reportsBucketArn: string;
    imagesBucketArn: string;
    avatarBucketArn: string;
    machineClientSecretArn: string;
    /**
     * Fraud-agent M2M client secret ARN (A2A hop, `features.a2a`). Undefined
     * when the fraud hop is disabled. Both the fraud runtime (to call the
     * Gateway as its own principal) and the account-opening agent (to
     * authenticate to the fraud runtime with the fraud client) read this
     * secret, and both runtimes share this execution role.
     */
    fraudClientSecretArn?: string;
    /**
     * Prompt Optimization showcase (`features.prompt_optimization`). When true,
     * the shared Bedrock statement additionally grants `bedrock:OptimizePrompt`
     * so the orchestrator runtime can call the Bedrock `OptimizePrompt`
     * streaming API for the AI Agent's current system prompt. Least-privilege:
     * the action is added only when the showcase is enabled, so a stack built
     * without it never holds the permission. Defaults to undefined (off).
     */
    enablePromptOptimization?: boolean;
    /**
     * Custom SageMaker model for the AI Agent (`features.sagemaker_model`). When
     * true, the shared role is granted `sagemaker:InvokeEndpoint`
     * (+ streaming) scoped to `sagemakerEndpointName` so the AI Agent runtime
     * can invoke a model hosted on that SageMaker inference endpoint. The grant
     * is added only when enabled (least privilege). Defaults to undefined (off).
     */
    enableSagemakerModel?: boolean;
    /**
     * Name of the SageMaker inference endpoint the AI Agent invokes. Used to
     * scope the `sagemaker:InvokeEndpoint` grant when `enableSagemakerModel` is
     * true. Ignored when the flag is off.
     */
    sagemakerEndpointName?: string;
    /**
     * AgentCore Identity token path (`features.agentcore_identity`). When true,
     * runtimes are granted the Identity data-plane actions needed to mint
     * Gateway tokens through the token vault (GetWorkloadAccessToken →
     * GetResourceOauth2Token) instead of calling Cognito directly. Added only
     * when enabled (least privilege). Defaults to undefined (off).
     */
    enableAgentCoreIdentity?: boolean;
    /**
     * Managed Bedrock evaluation for the AI Assistant catalog
     * (`features.bedrock_managed_eval`). When true, the shared role is granted
     * the model-evaluation actions plus `iam:PassRole` on ITSELF (the role
     * Bedrock assumes to run the job — this role already trusts
     * `bedrock.amazonaws.com` and can read/write the images bucket + invoke the
     * judge model). Added only when enabled (least privilege). Defaults to
     * undefined (off).
     */
    enableManagedEval?: boolean;
    /**
     * AgentCore batch evaluation for the AI Assistant (`features.agentcore_evaluation`).
     * When true, the AI Assistant runtime is granted the actions to look up the
     * custom evaluator and start/poll an on-demand batch evaluation of recent
     * session traces (the console-visible, pollable eval artifact). Added only
     * when enabled. Defaults to undefined (off).
     */
    enableAgentCoreEval?: boolean;
}

export function createAgentCoreRole(
    scope: Construct,
    stackName: string,
    props: AgentCoreRoleProps
): Role {
    const role = new Role(scope, "AgentCoreRole", {
        roleName: `${stackName}-agentcore-role`,
        assumedBy: new CompositePrincipal(
            new ServicePrincipal("bedrock-agentcore.amazonaws.com"),
            new ServicePrincipal("bedrock.amazonaws.com")
        ),
    });

    // ECR access for Docker image pull
    role.addToPolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
            ],
            resources: ["*"],
        })
    );

    // CloudWatch Logs
    role.addToPolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
            resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:*`],
        })
    );

    // X-Ray tracing
    role.addToPolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
            resources: ["*"],
        })
    );

    // CloudWatch metrics
    role.addToPolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["cloudwatch:PutMetricData"],
            resources: ["*"],
        })
    );

    // Bedrock model invocation. When the Prompt Optimization showcase is
    // enabled, `bedrock:OptimizePrompt` is added so the orchestrator runtime
    // can call the OptimizePrompt streaming API; it is omitted otherwise for
    // least privilege. OptimizePrompt is not resource-scoped, so it shares the
    // existing broad Bedrock statement's `*` resource.
    role.addToPolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream",
                "bedrock:InvokeModelWithBidirectionalStream",
                "bedrock:Retrieve",
                "bedrock:RetrieveAndGenerate",
                "bedrock:StartAsyncInvoke",
                "bedrock:GetAsyncInvoke",
                "bedrock:ApplyGuardrail",
                ...(props.enablePromptOptimization ? ["bedrock:OptimizePrompt"] : []),
            ],
            resources: ["*"],
        })
    );

    // Custom SageMaker model invocation (features.sagemaker_model). Added only
    // when the flag is on, scoped to the single configured endpoint so the
    // stack never holds a broad SageMaker permission by default. Includes the
    // streaming variant because the Strands SageMakerAIModel streams responses.
    if (props.enableSagemakerModel && props.sagemakerEndpointName) {
        role.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["sagemaker:InvokeEndpoint", "sagemaker:InvokeEndpointWithResponseStream"],
                resources: [
                    `arn:aws:sagemaker:${Aws.REGION}:${Aws.ACCOUNT_ID}:endpoint/${props.sagemakerEndpointName}`,
                ],
            })
        );
    }

    // Secrets Manager — the shared machine client secret, plus the fraud-agent
    // M2M client secret when the A2A fraud hop is enabled.
    role.addToPolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["secretsmanager:GetSecretValue"],
            resources: [
                props.machineClientSecretArn,
                ...(props.fraudClientSecretArn ? [props.fraudClientSecretArn] : []),
            ],
        })
    );

    // SSM Parameter Store
    role.addToPolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["ssm:GetParameter", "ssm:GetParameters"],
            resources: [`arn:aws:ssm:${Aws.REGION}:${Aws.ACCOUNT_ID}:parameter/${stackName}/*`],
        })
    );

    // AgentCore Identity data plane (features.agentcore_identity). Lets the
    // runtimes exchange their auto-created workload identity for a Gateway
    // bearer via the Identity token vault. Identity workload/provider ARNs are
    // created at runtime by the service (default workload identity directory),
    // so the actions are not resource-scopeable here.
    if (props.enableAgentCoreIdentity) {
        role.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "bedrock-agentcore:GetWorkloadAccessToken",
                    "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
                    "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
                    "bedrock-agentcore:GetResourceOauth2Token",
                ],
                resources: ["*"],
            })
        );
        // GetResourceOauth2Token reads the credential provider's client secret
        // from the Identity token vault, which is backed by service-managed
        // Secrets Manager secrets under the `bedrock-agentcore-identity!`
        // prefix — the caller's role must be able to read them or the exchange
        // fails with AccessDenied and agents fall back to direct Cognito.
        role.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["secretsmanager:GetSecretValue"],
                resources: [
                    `arn:aws:secretsmanager:${Aws.REGION}:${Aws.ACCOUNT_ID}:secret:bedrock-agentcore-identity!*`,
                ],
            })
        );
    }

    // AgentCore Memory operations
    role.addToPolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                "bedrock-agentcore:CreateMemory",
                "bedrock-agentcore:GetMemory",
                "bedrock-agentcore:CreateEvent",
                "bedrock-agentcore:GetEvent",
                "bedrock-agentcore:ListEvents",
            ],
            resources: ["*"],
        })
    );

    // DynamoDB access
    role.addToPolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                "dynamodb:GetItem",
                "dynamodb:PutItem",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem",
                "dynamodb:Query",
                "dynamodb:Scan",
            ],
            resources: [
                props.sessionsTableArn,
                props.customersTableArn,
                props.metadataTableArn,
                `${props.metadataTableArn}/index/*`,
            ],
        })
    );

    // S3 access
    role.addToPolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
            resources: [
                props.reportsBucketArn,
                `${props.reportsBucketArn}/*`,
                props.imagesBucketArn,
                `${props.imagesBucketArn}/*`,
                props.avatarBucketArn,
                `${props.avatarBucketArn}/*`,
            ],
        })
    );

    // Managed Bedrock evaluation (features.bedrock_managed_eval). The
    // orchestrator (ai_assistant) launches two model-as-a-judge evaluation jobs
    // over the catalog descriptions on demand. CreateEvaluationJob is not
    // resource-scopeable, so it shares a `*` resource; the far more sensitive
    // grant — iam:PassRole — is scoped to THIS role's own ARN and conditioned
    // to the Bedrock service, so the runtime can pass only itself as the job's
    // execution role and only to Bedrock. Added only when the flag is on.
    if (props.enableManagedEval) {
        role.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "bedrock:CreateEvaluationJob",
                    "bedrock:GetEvaluationJob",
                    "bedrock:ListEvaluationJobs",
                    "bedrock:StopEvaluationJob",
                ],
                resources: ["*"],
            })
        );
        role.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["iam:PassRole"],
                // Constructed self-ARN (not the Role token) to avoid a policy →
                // role → policy cycle; the role name is deterministic.
                resources: [`arn:aws:iam::${Aws.ACCOUNT_ID}:role/${stackName}-agentcore-role`],
                conditions: {
                    StringEquals: { "iam:PassedToService": "bedrock.amazonaws.com" },
                },
            })
        );
    }

    // AgentCore batch evaluation (features.agentcore_evaluation). Lets the AI
    // Assistant runtime find the custom evaluator and start/poll an on-demand
    // batch evaluation of recent session traces. Not resource-scopeable (the
    // evaluator/batch ARNs are created at runtime), so `*`. Added only when on.
    if (props.enableAgentCoreEval) {
        role.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "bedrock-agentcore:ListEvaluators",
                    "bedrock-agentcore:GetEvaluator",
                    "bedrock-agentcore:StartBatchEvaluation",
                    "bedrock-agentcore:GetBatchEvaluation",
                    "bedrock-agentcore:ListBatchEvaluations",
                ],
                resources: ["*"],
            })
        );
        // StartBatchEvaluation validates the caller can access the source log
        // group ('aws/spans') via logs:DescribeLogGroups, and the running
        // evaluation reads the session spans back out of it (via Logs Insights).
        // Without these it fails with:
        //   "Cannot verify log group 'aws/spans'. Please ensure the execution
        //    role has logs:DescribeLogGroups permission."
        // DescribeLogGroups isn't resource-scopeable, so it's on log-group:*;
        // the read is scoped to the aws/spans source group.
        role.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["logs:DescribeLogGroups"],
                resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:*`],
            })
        );
        role.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "logs:DescribeLogStreams",
                    "logs:GetLogEvents",
                    "logs:FilterLogEvents",
                    "logs:StartQuery",
                ],
                resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:aws/spans:*`],
            })
        );
        // StopQuery/GetQueryResults act on a query id, not a log group, so they
        // are not resource-scopeable.
        role.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["logs:StopQuery", "logs:GetQueryResults"],
                resources: ["*"],
            })
        );
    }

    // Runtime-to-runtime invocation
    role.addToPolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["bedrock-agentcore:InvokeRuntime"],
            resources: ["*"],
        })
    );

    // Code Interpreter
    role.addToPolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                "bedrock-agentcore:CreateCodeInterpreterSession",
                "bedrock-agentcore:ExecuteCodeInterpreter",
            ],
            resources: ["*"],
        })
    );

    // Browser
    role.addToPolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                "bedrock-agentcore:StartBrowserSession",
                "bedrock-agentcore:StopBrowserSession",
                "bedrock-agentcore:GetBrowserSession",
                "bedrock-agentcore:ListBrowserSessions",
                "bedrock-agentcore:UpdateBrowserStream",
                "bedrock-agentcore:ConnectBrowserAutomationStream",
                "bedrock-agentcore:ConnectBrowserLiveViewStream",
            ],
            resources: ["*"],
        })
    );

    return role;
}
