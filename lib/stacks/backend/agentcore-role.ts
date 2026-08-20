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
     * Fine-tuned custom model for the AI Agent (`features.custom_model`). When
     * true, the shared role is granted `bedrock:InvokeModel` (+ streaming)
     * scoped to `customModelArn` so the AI Agent runtime can invoke the bank's
     * model served via Bedrock Custom Model Import. The grant is added only
     * when enabled (least privilege). Defaults to undefined (off).
     */
    enableCustomModel?: boolean;
    /**
     * Bedrock Custom Import model ARN the AI Agent invokes. Used to scope the
     * `bedrock:InvokeModel*` grant when `enableCustomModel` is true. Ignored
     * when the flag is off.
     */
    customModelArn?: string;
    /**
     * AgentCore Identity token path (`features.agentcore_identity`). When true,
     * runtimes are granted the Identity data-plane actions needed to mint
     * Gateway tokens through the token vault (GetWorkloadAccessToken →
     * GetResourceOauth2Token) instead of calling Cognito directly. Added only
     * when enabled (least privilege). Defaults to undefined (off).
     */
    enableAgentCoreIdentity?: boolean;
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

    // Fine-tuned custom model invocation (features.custom_model). Added only
    // when the flag is on, scoped to the single configured Bedrock Custom
    // Import model ARN so the stack never holds a broad Bedrock-invoke
    // permission by default. Includes the streaming variant because the
    // BedrockImportedModel provider streams responses.
    if (props.enableCustomModel && props.customModelArn) {
        role.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
                resources: [props.customModelArn],
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
