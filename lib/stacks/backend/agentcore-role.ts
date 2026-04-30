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

    // Bedrock model invocation
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
            ],
            resources: ["*"],
        })
    );

    // Secrets Manager
    role.addToPolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["secretsmanager:GetSecretValue"],
            resources: [props.machineClientSecretArn],
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
