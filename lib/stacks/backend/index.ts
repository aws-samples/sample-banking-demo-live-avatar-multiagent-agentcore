/* eslint-disable @typescript-eslint/no-require-imports */
import { Aws, CfnOutput, CfnResource, Duration, RemovalPolicy, StackProps } from "aws-cdk-lib";
import { CfnGuardrail } from "aws-cdk-lib/aws-bedrock";
import { CfnGateway, CfnGatewayTarget, CfnRuntime } from "aws-cdk-lib/aws-bedrockagentcore";
import {
    AttributeType,
    BillingMode,
    ProjectionType,
    Table,
    TableEncryption,
} from "aws-cdk-lib/aws-dynamodb";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import { Effect, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import {
    Architecture,
    Code,
    Function as LambdaFunction,
    Runtime as LambdaRuntime,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as fs from "fs";
import * as path from "path";
import { Stack } from "../../common/constructs/stack";
import { getFeatureFlags, getModelConfig, getStackNameBase } from "../../common/feature-flags";
import { createAgentCoreRole } from "./agentcore-role";
import { Auth } from "../auth";
import { Shared } from "../shared";

export interface BackendProps extends StackProps {
    auth: Auth;
    shared: Shared;
}

export class Backend extends Stack {
    public readonly orchestratorRuntimeArn: string = "";
    public readonly avatarRuntimeArn: string = "";
    public readonly feedbackApiUrl: string = "";
    public readonly gatewayUrl: string = "";

    constructor(scope: Construct, id: string, props: BackendProps) {
        super(scope, id, props);

        const { auth, shared } = props;
        const features = getFeatureFlags(this.node);
        const models = getModelConfig(this.node);
        const stackName = getStackNameBase(this.node);

        const userPool = auth.userPool;
        const userPoolClient = auth.userPoolClient;

        // ─── AgentCore IAM Role ────────────────────────────────────────
        const agentCoreRole = createAgentCoreRole(this, stackName, {
            sessionsTableArn: shared.sessionsTable.tableArn,
            customersTableArn: shared.customersTable.tableArn,
            metadataTableArn: shared.metadataTable.tableArn,
            reportsBucketArn: shared.reportsBucket.bucketArn,
            imagesBucketArn: shared.imagesBucket.bucketArn,
            avatarBucketArn: shared.avatarBucket.bucketArn,
            machineClientSecretArn: auth.machineClientSecret.secretArn,
        });
        NagSuppressions.addResourceSuppressions(
            agentCoreRole,
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "AgentCore role requires wildcard resources for ECR, Bedrock, X-Ray, CloudWatch, Memory, and runtime invocation.",
                },
            ],
            true
        );

        // ─── AgentCore Memory ──────────────────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const memoryStrategies: any[] = [];
        if (features.episodic_memory) {
            memoryStrategies.push({
                EpisodicMemoryStrategy: {
                    Name: `${stackName.replace(/-/g, "_")}_episodic`,
                    Description: "Episodic memory with reflection for conversation recall",
                    Namespaces: [
                        `/strategies/{memoryStrategyId}/actors/{actorId}/sessions/{sessionId}/`,
                    ],
                    ReflectionConfiguration: {
                        Namespaces: [`/strategies/{memoryStrategyId}/actors/{actorId}/`],
                    },
                },
            });
        }
        if (features.semantic_memory) {
            memoryStrategies.push({
                SemanticMemoryStrategy: {
                    Name: `${stackName.replace(/-/g, "_")}_semantic`,
                    Description: "Cross-session fact extraction",
                    Namespaces: [`/strategies/{memoryStrategyId}/actors/{actorId}/`],
                },
            });
        }
        if (features.user_preference_memory) {
            memoryStrategies.push({
                UserPreferenceMemoryStrategy: {
                    Name: `${stackName.replace(/-/g, "_")}_preferences`,
                    Description: "User research preferences and patterns",
                    Namespaces: [`/strategies/{memoryStrategyId}/actors/{actorId}/`],
                },
            });
        }

        const memory = new CfnResource(this, "AgentMemory", {
            type: "AWS::BedrockAgentCore::Memory",
            properties: {
                Name: `${stackName.replace(/-/g, "_")}_memory`,
                EventExpiryDuration: 30,
                Description: `Memory for ${stackName} agents`,
                MemoryStrategies: memoryStrategies,
                MemoryExecutionRoleArn: agentCoreRole.roleArn,
            },
        });
        const memoryId = memory.getAtt("MemoryId").toString();
        const memoryArn = memory.getAtt("MemoryArn").toString();

        agentCoreRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "bedrock-agentcore:CreateEvent",
                    "bedrock-agentcore:GetEvent",
                    "bedrock-agentcore:DeleteEvent",
                    "bedrock-agentcore:ListEvents",
                    "bedrock-agentcore:RetrieveMemoryRecords",
                    "bedrock-agentcore:StartMemoryExtractionJob",
                    "bedrock-agentcore:ListMemoryExtractionJobs",
                ],
                resources: [memoryArn],
            })
        );

        // ─── Gateway IAM Role ──────────────────────────────────────────
        const gatewayRole = new Role(this, "GatewayRole", {
            assumedBy: new ServicePrincipal("bedrock-agentcore.amazonaws.com"),
            description: "Role for AgentCore Gateway",
        });

        gatewayRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "bedrock:InvokeModel",
                    "bedrock:InvokeModelWithResponseStream",
                    "bedrock:StartAsyncInvoke",
                    "bedrock:GetAsyncInvoke",
                    "bedrock:Retrieve",
                    "bedrock:RetrieveAndGenerate",
                ],
                resources: ["*"],
            })
        );

        gatewayRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
                resources: [`arn:aws:logs:${this.region}:${this.account}:*`],
            })
        );

        gatewayRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["lambda:InvokeFunction"],
                resources: [
                    `arn:aws:lambda:${this.region}:${this.account}:function:${stackName}-tool-*`,
                ],
            })
        );

        NagSuppressions.addResourceSuppressions(
            gatewayRole,
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "Gateway role requires wildcard for Bedrock model invocation and prefixed wildcard for tool Lambda invocation.",
                },
            ],
            true
        );

        // ─── Tool Lambdas ──────────────────────────────────────────────
        const toolLambdas: Record<string, LambdaFunction> = {};
        const repoRoot = path.resolve(__dirname, "..", "..", "..");

        const commonEnv: Record<string, string> = {
            AWS_ACCOUNT_ID: this.account,
            SESSIONS_TABLE: shared.sessionsTable.tableName,
            CUSTOMERS_TABLE: shared.customersTable.tableName,
            METADATA_TABLE: shared.metadataTable.tableName,
            REPORTS_BUCKET: shared.reportsBucket.bucketName,
            IMAGES_BUCKET: shared.imagesBucket.bucketName,
            AVATAR_BUCKET: shared.avatarBucket.bucketName,
        };

        const kbId = features.knowledge_base
            ? StringParameter.valueForStringParameter(this, `/${stackName}/knowledge_base_id`)
            : undefined;
        const kbDataSourceId = features.knowledge_base
            ? StringParameter.valueForStringParameter(this, `/${stackName}/kb_data_source_id`)
            : undefined;

        if (features.knowledge_base && kbId) {
            commonEnv.KNOWLEDGE_BASE_ID = kbId;
        }

        // Pass memory IDs to tool Lambdas (used by recall_memories, save_memory).
        // The tools use `/actors/{user_id}/` namespace for retrieval (no strategy
        // prefix), which lets us avoid resolving the generated strategy IDs at
        // deploy time. AgentCore Memory's CreateEvent API doesn't take a strategy
        // ID either — strategies process events asynchronously into records that
        // share the actor's namespace. See docs/kb-isolation.md for the broader
        // memory architecture notes.
        commonEnv.MEMORY_ID = memoryId;

        const toolDefs: Array<{
            dir: string;
            handler: string;
            timeout: number;
            memory: number;
            extraEnv?: Record<string, string>;
        }> = [
            { dir: "kb_search", handler: "handler.handler", timeout: 300, memory: 256 },
            { dir: "web_search", handler: "handler.handler", timeout: 300, memory: 256 },
            { dir: "pdf_generator", handler: "handler.handler", timeout: 900, memory: 512 },
            { dir: "nova_canvas_generate", handler: "handler.handler", timeout: 300, memory: 512 },
            { dir: "nova_canvas_edit", handler: "handler.handler", timeout: 300, memory: 512 },
            { dir: "nova_canvas_history", handler: "handler.handler", timeout: 60, memory: 128 },
            { dir: "nova_reel_generate", handler: "handler.handler", timeout: 300, memory: 256 },
            { dir: "nova_reel_status", handler: "handler.handler", timeout: 60, memory: 128 },
            { dir: "nova_reel_history", handler: "handler.handler", timeout: 60, memory: 128 },
            { dir: "save_memory", handler: "handler.handler", timeout: 300, memory: 256 },
            { dir: "recall_memories", handler: "handler.handler", timeout: 300, memory: 256 },
            { dir: "analyze_patterns", handler: "handler.handler", timeout: 300, memory: 256 },
            { dir: "retrieve_user_profile", handler: "handler.handler", timeout: 60, memory: 128 },
            { dir: "place_order", handler: "handler.handler", timeout: 300, memory: 256 },
            { dir: "data_sources", handler: "handler.handler", timeout: 30, memory: 128 },
            { dir: "website_generator", handler: "handler.handler", timeout: 900, memory: 512 },
            { dir: "extract_pdf_images", handler: "handler.handler", timeout: 900, memory: 256 },
            {
                dir: "sample_tool",
                handler: "sample_tool_lambda.handler",
                timeout: 300,
                memory: 128,
            },
        ];

        for (const def of toolDefs) {
            const toolDir = path.join(repoRoot, "gateway", "tools", def.dir);
            if (!fs.existsSync(toolDir)) continue;

            const hasRequirements = fs.existsSync(path.join(toolDir, "requirements.txt"));
            const toolLogGroup = new LogGroup(this, `ToolLog_${def.dir}`, {
                logGroupName: `/aws/lambda/${stackName}-tool-${def.dir}`,
                retention: RetentionDays.ONE_WEEK,
                removalPolicy: RemovalPolicy.DESTROY,
            });

            const code = hasRequirements
                ? Code.fromAsset(toolDir, {
                      bundling: {
                          image: LambdaRuntime.PYTHON_3_13.bundlingImage,
                          command: [
                              "bash",
                              "-c",
                              "pip install -r requirements.txt -t /asset-output && cp -r . /asset-output",
                          ],
                          local: {
                              tryBundle(outputDir: string): boolean {
                                  try {
                                      const cp = require("child_process");
                                      cp.execSync(
                                          `python3 -m pip install -r ${path.join(toolDir, "requirements.txt")} -t "${outputDir}" --quiet --no-cache-dir --platform manylinux2014_aarch64 --only-binary :all: --implementation cp --python-version 3.13`,
                                          { stdio: "pipe" }
                                      );
                                      cp.execSync(`cp -r "${toolDir}/"* "${outputDir}/"`, {
                                          stdio: "pipe",
                                          shell: "/bin/bash",
                                      });
                                      return true;
                                  } catch {
                                      return false;
                                  }
                              },
                          },
                      },
                  })
                : Code.fromAsset(toolDir);

            const fn = new LambdaFunction(this, `Tool_${def.dir}`, {
                functionName: `${stackName}-tool-${def.dir}`,
                runtime: LambdaRuntime.PYTHON_3_13,
                handler: def.handler,
                code,
                timeout: Duration.seconds(def.timeout),
                memorySize: def.memory,
                architecture: Architecture.ARM_64,
                environment: { ...commonEnv, ...(def.extraEnv || {}) },
                logGroup: toolLogGroup,
            });

            shared.sessionsTable.grantReadWriteData(fn);
            shared.customersTable.grantReadData(fn);
            shared.metadataTable.grantReadWriteData(fn);
            shared.reportsBucket.grantReadWrite(fn);
            shared.imagesBucket.grantReadWrite(fn);
            shared.avatarBucket.grantReadWrite(fn);

            fn.addToRolePolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        "bedrock:InvokeModel",
                        "bedrock:InvokeModelWithResponseStream",
                        "bedrock:StartAsyncInvoke",
                        "bedrock:GetAsyncInvoke",
                        "bedrock:Retrieve",
                        "bedrock:RetrieveAndGenerate",
                        "bedrock:InvokeTool",
                        "bedrock-agentcore:*",
                    ],
                    resources: ["*"],
                })
            );

            fn.grantInvoke(gatewayRole);

            if (def.dir === "kb_search" && shared.kbDocsBucket) {
                shared.kbDocsBucket.grantRead(fn);
            }

            toolLambdas[def.dir] = fn;
        }

        // Grant AgentCore Memory permissions to memory tool Lambdas
        for (const memToolDir of ["recall_memories", "save_memory"]) {
            const memFn = toolLambdas[memToolDir];
            if (memFn) {
                memFn.addToRolePolicy(
                    new PolicyStatement({
                        effect: Effect.ALLOW,
                        actions: [
                            "bedrock-agentcore:RetrieveMemoryRecords",
                            "bedrock-agentcore:CreateEvent",
                            "bedrock-agentcore:GetEvent",
                            "bedrock-agentcore:ListEvents",
                        ],
                        resources: [memoryArn],
                    })
                );
            }
        }

        // ─── AgentCore Gateway ─────────────────────────────────────────
        const cognitoIssuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;

        const gateway = new CfnGateway(this, "Gateway", {
            name: `${stackName}-gateway`,
            roleArn: gatewayRole.roleArn,
            protocolType: "MCP",
            protocolConfiguration: {
                mcp: {
                    supportedVersions: ["2025-03-26"],
                },
            },
            authorizerType: "CUSTOM_JWT",
            authorizerConfiguration: {
                customJwtAuthorizer: {
                    allowedClients: [auth.machineClient.userPoolClientId],
                    discoveryUrl: `${cognitoIssuer}/.well-known/openid-configuration`,
                },
            },
            description: `AgentCore Gateway for ${stackName}`,
        });

        for (const [toolDir, fn] of Object.entries(toolLambdas)) {
            const toolSpecPath = path.join(repoRoot, "gateway", "tools", toolDir, "tool_spec.json");
            if (!fs.existsSync(toolSpecPath)) continue;

            const apiSpec = JSON.parse(fs.readFileSync(toolSpecPath, "utf8"));
            const toolSpec = Array.isArray(apiSpec) ? apiSpec : [apiSpec];

            const target = new CfnGatewayTarget(this, `Target_${toolDir}`, {
                gatewayIdentifier: gateway.attrGatewayIdentifier,
                name: toolDir.replace(/_/g, "-"),
                description: `Lambda target for ${toolDir}`,
                targetConfiguration: {
                    mcp: {
                        lambda: {
                            lambdaArn: fn.functionArn,
                            toolSchema: {
                                inlinePayload: toolSpec,
                            },
                        },
                    },
                },
                credentialProviderConfigurations: [{ credentialProviderType: "GATEWAY_IAM_ROLE" }],
            });

            target.addDependency(gateway);
            target.node.addDependency(gatewayRole);
        }

        this.gatewayUrl = gateway.attrGatewayUrl;

        new StringParameter(this, "GatewayUrlParam", {
            parameterName: `/${stackName}/gateway_url`,
            stringValue: gateway.attrGatewayUrl,
        });

        // ─── AgentCore Runtimes ────────────────────────────────────────
        const jwtDiscoveryUrl = `${cognitoIssuer}/.well-known/openid-configuration`;
        const authorizerConfig = agentcore.RuntimeAuthorizerConfiguration.usingJWT(
            jwtDiscoveryUrl,
            [userPoolClient.userPoolClientId]
        );
        const networkConfig = agentcore.RuntimeNetworkConfiguration.usingPublicNetwork();

        const runtimeEnv: Record<string, string> = {
            AWS_REGION: this.region,
            AWS_DEFAULT_REGION: this.region,
            MEMORY_ID: memoryId,
            STACK_NAME: stackName,
        };

        const runtimeArns: Record<string, string> = {};

        // ─── Orchestrator Runtime ──────────────────────────────────────
        {
            const orchestratorRuntimeName = `${stackName.replace(/-/g, "_")}_orchestrator`;
            const orchestratorPatternDir = "patterns/orchestrator-agent";

            const orchestratorArtifact = agentcore.AgentRuntimeArtifact.fromAsset(repoRoot, {
                platform: Platform.LINUX_ARM64,
                file: `${orchestratorPatternDir}/Dockerfile`,
            });

            const orchestratorRuntime = new agentcore.Runtime(this, "Runtime_orchestrator", {
                runtimeName: orchestratorRuntimeName,
                agentRuntimeArtifact: orchestratorArtifact,
                executionRole: agentCoreRole,
                networkConfiguration: networkConfig,
                protocolConfiguration: agentcore.ProtocolType.HTTP,
                environmentVariables: {
                    ...runtimeEnv,
                    MODEL_ID: models.orchestrator,
                    // Gate the in-process browser_tools import so operators
                    // can disable the microVM spend without rebuilding the
                    // image. See patterns/orchestrator-agent/browser_tools.py.
                    ENABLE_BROWSER_TOOLS: features.browser ? "true" : "false",
                },
                authorizerConfiguration: authorizerConfig,
                requestHeaderConfiguration: {
                    allowlistedHeaders: ["Authorization"],
                },
                description: `In-process orchestrator for ${stackName}`,
            });

            this.orchestratorRuntimeArn = orchestratorRuntime.agentRuntimeArn;
            runtimeArns["orchestrator"] = orchestratorRuntime.agentRuntimeArn;

            new StringParameter(this, "RuntimeArn_orchestrator", {
                parameterName: `/${stackName}/runtime_arn_orchestrator`,
                stringValue: orchestratorRuntime.agentRuntimeArn,
            });

            new CfnOutput(this, "RuntimeArn_orchestrator_Output", {
                value: orchestratorRuntime.agentRuntimeArn,
                description: "Runtime ARN for orchestrator agent",
            });
        }

        // ─── Avatar Runtime (feature-gated) ────────────────────────────
        if (features.avatar) {
            const avatarRuntimeName = `${stackName.replace(/-/g, "_")}_avatar`;

            const avatarImage = new DockerImageAsset(this, "AvatarImage", {
                directory: repoRoot,
                file: "patterns/avatar-agent/Dockerfile",
                platform: Platform.LINUX_ARM64,
            });

            const avatarRuntime = new CfnRuntime(this, "Runtime_avatar", {
                agentRuntimeName: avatarRuntimeName,
                agentRuntimeArtifact: {
                    containerConfiguration: {
                        containerUri: avatarImage.imageUri,
                    },
                },
                roleArn: agentCoreRole.roleArn,
                networkConfiguration: {
                    networkMode: "PUBLIC",
                },
                protocolConfiguration: "HTTP",
                environmentVariables: {
                    ...runtimeEnv,
                    MODEL_ID: models.avatar_sonic,
                    TOOL_SELECTOR_MODEL_ID: models.avatar_tool_selector,
                    PERSONA: "friendly",
                },
                description: `Avatar voice agent (Nova Sonic) for ${stackName}`,
            });

            avatarRuntime.node.addDependency(agentCoreRole);

            this.avatarRuntimeArn = avatarRuntime.attrAgentRuntimeArn;
            runtimeArns["avatar"] = avatarRuntime.attrAgentRuntimeArn;

            new StringParameter(this, "RuntimeArn_avatar", {
                parameterName: `/${stackName}/runtime_arn_avatar`,
                stringValue: avatarRuntime.attrAgentRuntimeArn,
            });

            new CfnOutput(this, "RuntimeArn_avatar_Output", {
                value: avatarRuntime.attrAgentRuntimeArn,
                description: "Runtime ARN for avatar agent",
            });
        }

        // ─── Feedback API ──────────────────────────────────────────────
        const feedbackTable = new Table(this, "FeedbackTable", {
            tableName: `${stackName}-feedback`,
            partitionKey: { name: "feedbackId", type: AttributeType.STRING },
            billingMode: BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.DESTROY,
            encryption: TableEncryption.AWS_MANAGED,
        });
        NagSuppressions.addResourceSuppressions(feedbackTable, [
            { id: "AwsSolutions-DDB3", reason: "PITR not required for demo feedback data." },
        ]);

        feedbackTable.addGlobalSecondaryIndex({
            indexName: "feedbackType-timestamp-index",
            partitionKey: { name: "feedbackType", type: AttributeType.STRING },
            sortKey: { name: "timestamp", type: AttributeType.NUMBER },
            projectionType: ProjectionType.ALL,
        });

        const feedbackLambdaDir = path.join(__dirname, "..", "..", "lambdas", "feedback");
        if (fs.existsSync(feedbackLambdaDir)) {
            const corsOrigins = ["*"];

            const feedbackLogGroup = new LogGroup(this, "FeedbackLogGroup", {
                logGroupName: `/aws/lambda/${stackName}-feedback`,
                retention: RetentionDays.ONE_WEEK,
                removalPolicy: RemovalPolicy.DESTROY,
            });

            const feedbackLambda = new LambdaFunction(this, "FeedbackLambda", {
                functionName: `${stackName}-feedback`,
                runtime: LambdaRuntime.PYTHON_3_13,
                handler: "index.handler",
                architecture: Architecture.ARM_64,
                logGroup: feedbackLogGroup,
                code: Code.fromAsset(feedbackLambdaDir, {
                    bundling: {
                        image: LambdaRuntime.PYTHON_3_13.bundlingImage,
                        command: [
                            "bash",
                            "-c",
                            "pip install -r requirements.txt -t /asset-output && cp -r . /asset-output",
                        ],
                        local: {
                            tryBundle(outputDir: string): boolean {
                                try {
                                    const cp = require("child_process");
                                    cp.execSync(
                                        `python3 -m pip install -r ${path.join(feedbackLambdaDir, "requirements.txt")} -t "${outputDir}" --quiet --no-cache-dir`,
                                        { stdio: "pipe" }
                                    );
                                    cp.execSync(`cp -r "${feedbackLambdaDir}/"* "${outputDir}/"`, {
                                        stdio: "pipe",
                                        shell: "/bin/bash",
                                    });
                                    return true;
                                } catch {
                                    return false;
                                }
                            },
                        },
                    },
                }),
                environment: {
                    TABLE_NAME: feedbackTable.tableName,
                    CORS_ALLOWED_ORIGINS: corsOrigins.join(","),
                },
                timeout: Duration.seconds(300),
            });

            feedbackTable.grantWriteData(feedbackLambda);

            const api = new apigateway.RestApi(this, "FeedbackApi", {
                restApiName: `${stackName}-api`,
                description: "Feedback API",
                deployOptions: {
                    loggingLevel: apigateway.MethodLoggingLevel.ERROR,
                },
                defaultCorsPreflightOptions: {
                    allowOrigins: apigateway.Cors.ALL_ORIGINS,
                    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
                    allowHeaders: ["Content-Type", "Authorization"],
                },
            });
            NagSuppressions.addResourceSuppressions(
                api,
                [
                    {
                        id: "AwsSolutions-APIG2",
                        reason: "Request validation not required for demo feedback endpoint.",
                    },
                    {
                        id: "AwsSolutions-APIG4",
                        reason: "Cognito authorizer used instead of API key.",
                    },
                    {
                        id: "AwsSolutions-COG4",
                        reason: "Cognito authorizer is applied at method level.",
                    },
                    { id: "AwsSolutions-APIG1", reason: "Access logging not required for demo." },
                ],
                true
            );

            new CfnWebACLAssociation(this, "FeedbackApiWafAssociation", {
                resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/stages/${api.deploymentStage.stageName}`,
                webAclArn: auth.regionalWebAclArn,
            });

            const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "ApiAuthorizer", {
                cognitoUserPools: [userPool],
            });

            const feedbackResource = api.root.addResource("feedback");
            feedbackResource.addMethod("POST", new apigateway.LambdaIntegration(feedbackLambda), {
                authorizer,
                authorizationType: apigateway.AuthorizationType.COGNITO,
            });

            // ─── KB Reset Lambda ───────────────────────────────────────
            if (features.knowledge_base && kbId && kbDataSourceId) {
                const kbResetLambdaDir = path.join(__dirname, "..", "..", "lambdas", "kb-reset");
                if (fs.existsSync(kbResetLambdaDir)) {
                    const kbResetLogGroup = new LogGroup(this, "KbResetLogGroup", {
                        logGroupName: `/aws/lambda/${stackName}-kb-reset`,
                        retention: RetentionDays.ONE_WEEK,
                        removalPolicy: RemovalPolicy.DESTROY,
                    });

                    const kbResetLambda = new LambdaFunction(this, "KbResetLambda", {
                        functionName: `${stackName}-kb-reset`,
                        runtime: LambdaRuntime.PYTHON_3_13,
                        handler: "index.handler",
                        architecture: Architecture.ARM_64,
                        logGroup: kbResetLogGroup,
                        code: Code.fromAsset(kbResetLambdaDir, {
                            bundling: {
                                image: LambdaRuntime.PYTHON_3_13.bundlingImage,
                                command: [
                                    "bash",
                                    "-c",
                                    "pip install -r requirements.txt -t /asset-output && cp -r . /asset-output",
                                ],
                                local: {
                                    tryBundle(outputDir: string): boolean {
                                        try {
                                            const cp = require("child_process");
                                            cp.execSync(
                                                `python3 -m pip install -r ${path.join(kbResetLambdaDir, "requirements.txt")} -t "${outputDir}" --quiet --no-cache-dir`,
                                                { stdio: "pipe" }
                                            );
                                            cp.execSync(
                                                `cp -r "${kbResetLambdaDir}/"* "${outputDir}/"`,
                                                { stdio: "pipe", shell: "/bin/bash" }
                                            );
                                            return true;
                                        } catch {
                                            return false;
                                        }
                                    },
                                },
                            },
                        }),
                        environment: {
                            KB_DOCS_BUCKET: shared.kbDocsBucket.bucketName,
                            KNOWLEDGE_BASE_ID: kbId,
                            DATA_SOURCE_ID: kbDataSourceId,
                            CORS_ALLOWED_ORIGINS: corsOrigins.join(","),
                        },
                        timeout: Duration.seconds(60),
                    });

                    shared.kbDocsBucket.grantRead(kbResetLambda);
                    kbResetLambda.addToRolePolicy(
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ["s3:DeleteObject"],
                            resources: [shared.kbDocsBucket.arnForObjects("*")],
                        })
                    );
                    kbResetLambda.addToRolePolicy(
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ["bedrock:StartIngestionJob"],
                            resources: [
                                `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/${kbId}`,
                            ],
                        })
                    );

                    const kbResetResource = api.root.addResource("kb-reset");
                    kbResetResource.addMethod(
                        "POST",
                        new apigateway.LambdaIntegration(kbResetLambda),
                        {
                            authorizer,
                            authorizationType: apigateway.AuthorizationType.COGNITO,
                        }
                    );
                }
            }

            this.feedbackApiUrl = api.url;

            new StringParameter(this, "FeedbackApiUrlParam", {
                parameterName: `/${stackName}/feedback_api_url`,
                stringValue: api.url,
            });

            new CfnOutput(this, "FeedbackApiUrl", { value: api.url });
        }

        // ─── Guardrails (feature-gated) ────────────────────────────────
        if (features.guardrails) {
            const guardrail = new CfnGuardrail(this, "Guardrail", {
                name: `${stackName}-guardrail`,
                blockedInputMessaging: "Your request was blocked by a safety guardrail.",
                blockedOutputsMessaging: "The response was blocked by a safety guardrail.",
                description: `Content and topic guardrails for ${stackName}`,
                contentPolicyConfig: {
                    filtersConfig: [
                        { type: "SEXUAL", inputStrength: "HIGH", outputStrength: "HIGH" },
                        { type: "VIOLENCE", inputStrength: "LOW", outputStrength: "LOW" },
                        { type: "HATE", inputStrength: "MEDIUM", outputStrength: "MEDIUM" },
                        { type: "INSULTS", inputStrength: "MEDIUM", outputStrength: "MEDIUM" },
                        { type: "MISCONDUCT", inputStrength: "LOW", outputStrength: "LOW" },
                        { type: "PROMPT_ATTACK", inputStrength: "HIGH", outputStrength: "NONE" },
                    ],
                },
                topicPolicyConfig: {
                    topicsConfig: [
                        {
                            name: "politics_and_elections",
                            definition:
                                "Political opinions, endorsements, election commentary, or partisan policy debates",
                            type: "DENY",
                            examples: [
                                "Which political party is better",
                                "Who should I vote for in the next election",
                                "Write a political speech endorsing a candidate",
                            ],
                        },
                    ],
                },
                wordPolicyConfig: {
                    managedWordListsConfig: [{ type: "PROFANITY" }],
                },
            });

            new StringParameter(this, "GuardrailIdParam", {
                parameterName: `/${stackName}/guardrail_id`,
                stringValue: guardrail.attrGuardrailId,
            });

            new StringParameter(this, "GuardrailVersionParam", {
                parameterName: `/${stackName}/guardrail_version`,
                stringValue: guardrail.attrVersion,
            });

            new CfnOutput(this, "GuardrailId", {
                value: guardrail.attrGuardrailId,
                description: "Bedrock Guardrail ID",
            });
        }

        // ─── Durable Functions (feature-gated) ─────────────────────────
        if (features.durable_functions) {
            const orchestratorDir = path.join(
                repoRoot,
                "gateway",
                "tools",
                "research_orchestrator"
            );
            if (fs.existsSync(orchestratorDir)) {
                const orchestratorLambda = new LambdaFunction(this, "Tool_research_orchestrator", {
                    functionName: `${stackName}-tool-research-orchestrator`,
                    runtime: LambdaRuntime.PYTHON_3_13,
                    handler: "handler.handler",
                    code: Code.fromAsset(orchestratorDir),
                    timeout: Duration.minutes(15),
                    memorySize: 512,
                    architecture: Architecture.ARM_64,
                    environment: {
                        ...commonEnv,
                        STACK_NAME: stackName,
                        ...Object.fromEntries(
                            Object.entries(runtimeArns).map(([name, arn]) => [
                                `RUNTIME_ARN_${name.toUpperCase()}`,
                                arn,
                            ])
                        ),
                    },
                    logGroup: new LogGroup(this, "ToolLog_research_orchestrator", {
                        logGroupName: `/aws/lambda/${stackName}-tool-research-orchestrator`,
                        retention: RetentionDays.ONE_WEEK,
                        removalPolicy: RemovalPolicy.DESTROY,
                    }),
                });

                orchestratorLambda.addToRolePolicy(
                    new PolicyStatement({
                        effect: Effect.ALLOW,
                        actions: ["bedrock-agentcore:InvokeRuntime"],
                        resources: Object.values(runtimeArns),
                    })
                );

                orchestratorLambda.grantInvoke(gatewayRole);

                // Register as a Gateway target so MCP clients can actually
                // invoke it. Previously the Lambda was created but never
                // attached to the Gateway, leaving it unreachable.
                const orchestratorToolSpecPath = path.join(orchestratorDir, "tool_spec.json");
                if (fs.existsSync(orchestratorToolSpecPath)) {
                    const apiSpec = JSON.parse(fs.readFileSync(orchestratorToolSpecPath, "utf8"));
                    const toolSpec = Array.isArray(apiSpec) ? apiSpec : [apiSpec];
                    const target = new CfnGatewayTarget(this, "Target_research_orchestrator", {
                        gatewayIdentifier: gateway.attrGatewayIdentifier,
                        name: "research-orchestrator",
                        description:
                            "Lambda target for research_orchestrator (Durable Functions feature flag)",
                        targetConfiguration: {
                            mcp: {
                                lambda: {
                                    lambdaArn: orchestratorLambda.functionArn,
                                    toolSchema: { inlinePayload: toolSpec },
                                },
                            },
                        },
                        credentialProviderConfigurations: [
                            { credentialProviderType: "GATEWAY_IAM_ROLE" },
                        ],
                    });
                    target.addDependency(gateway);
                    target.node.addDependency(gatewayRole);
                }
            }
        }

        // ─── SSM: Cognito params for runtime auth ──────────────────────
        new StringParameter(this, "CognitoUserPoolIdParam", {
            parameterName: `/${stackName}/cognito_user_pool_id`,
            stringValue: userPool.userPoolId,
        });

        new StringParameter(this, "CognitoClientIdParam", {
            parameterName: `/${stackName}/cognito_client_id`,
            stringValue: userPoolClient.userPoolClientId,
        });

        if (auth.userPoolDomain) {
            new StringParameter(this, "CognitoDomainParam", {
                parameterName: `/${stackName}/cognito_provider`,
                stringValue: `${auth.userPoolDomain.domainName}.auth.${Aws.REGION}.amazoncognito.com`,
            });
        }

        new StringParameter(this, "MachineClientIdParam", {
            parameterName: `/${stackName}/machine_client_id`,
            stringValue: auth.machineClient.userPoolClientId,
        });

        // ─── Stack Outputs ─────────────────────────────────────────────
        new CfnOutput(this, "GatewayUrl", {
            value: gateway.attrGatewayUrl,
            description: "AgentCore Gateway URL",
        });

        new CfnOutput(this, "MemoryId", {
            value: memoryId,
            description: "AgentCore Memory ID",
        });
    }
}
