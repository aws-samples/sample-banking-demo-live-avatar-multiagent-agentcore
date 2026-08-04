/* eslint-disable @typescript-eslint/no-require-imports */
import { CfnOutput, Duration, RemovalPolicy, StackProps } from "aws-cdk-lib";
import {
    Vpc,
    SubnetType,
    SecurityGroup,
    FlowLogDestination,
    FlowLogTrafficType,
} from "aws-cdk-lib/aws-ec2";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import {
    Cluster,
    ContainerImage,
    CpuArchitecture,
    FargateService,
    FargateTaskDefinition,
    LogDriver,
    OperatingSystemFamily,
    Secret as EcsSecret,
} from "aws-cdk-lib/aws-ecs";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
    Architecture,
    Code,
    Function as LambdaFunction,
    Runtime as LambdaRuntime,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import { SecretValue } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";
import { Stack } from "../../common/constructs/stack";
import { getModelConfig, getStackNameBase } from "../../common/feature-flags";
import { Auth } from "../auth";

export interface LiveKitProps extends StackProps {
    auth: Auth;
}

interface LiveKitConfig {
    serverImage: string;
    serverCpu: number;
    serverMemory: number;
    workerCpu: number;
    workerMemory: number;
    /**
     * Nova Sonic voice for the worker. Fixed for the life of the task: rooms are
     * joined before the client sends any preference and the token endpoint
     * carries no voice, so the UI voice selector cannot reach this transport.
     * Must be one of the ids in the frontend's voice-config.ts VOICES.
     *
     * Default is female to match the default avatar, "Advisor", which is a female
     * GLB. On the LiveKit transport this is the voice regardless of which avatar
     * is on screen, so if you present the male "Realistic" photo avatar set this
     * to "matthew" and redeploy — the picker cannot change it at runtime.
     */
    voiceId: string;
}

const DEFAULT_LIVEKIT_CONFIG: LiveKitConfig = {
    serverImage: "livekit/livekit-server:v1.9",
    serverCpu: 512,
    serverMemory: 1024,
    workerCpu: 1024,
    workerMemory: 2048,
    voiceId: "tiffany",
};

/**
 * LiveKit voice stack (Option 1 — LiveKit Cloud + Fargate agent worker).
 *
 * The media plane runs on LiveKit Cloud (free tier). This stack deploys only
 * the in-account pieces:
 *   1. A Secrets Manager secret holding the LiveKit Cloud project credentials
 *      (url / api_key / api_secret). MANUAL STEP after first deploy: populate
 *      it (see README) — it ships with empty placeholders.
 *   2. A Fargate service running the Nova Sonic 2 agent worker
 *      (patterns/livekit-agent). It dials OUT to LiveKit Cloud, so there is no
 *      inbound listener, no NLB, and no TLS/UDP config here.
 *   3. A token API (REST + Cognito authorizer + Lambda) the browser calls to
 *      mint a LiveKit access token scoped to its Cognito identity.
 *
 * Gated by the `livekit` feature flag; not instantiated when the flag is off.
 */
export class LiveKit extends Stack {
    public readonly tokenApiUrl: string = "";

    constructor(scope: Construct, id: string, props: LiveKitProps) {
        super(scope, id, props);

        const { auth } = props;
        const stackName = getStackNameBase(this.node);
        const models = getModelConfig(this.node);
        const cfg: LiveKitConfig = {
            ...DEFAULT_LIVEKIT_CONFIG,
            ...(this.node.tryGetContext("livekit") ?? {}),
        };
        const repoRoot = path.join(__dirname, "..", "..", "..");

        // ─── LiveKit Cloud credentials secret ──────────────────────────
        // Ships with empty placeholders; operator populates post-deploy via:
        //   aws secretsmanager put-secret-value --secret-id /<stack>/livekit \
        //     --secret-string '{"url":"wss://<proj>.livekit.cloud","api_key":"...","api_secret":"..."}'
        const livekitSecret = new Secret(this, "LiveKitSecret", {
            secretName: `/${stackName}/livekit`,
            description: "LiveKit Cloud project credentials (url, api_key, api_secret)",
            secretObjectValue: {
                url: SecretValue.unsafePlainText(""),
                api_key: SecretValue.unsafePlainText(""),
                api_secret: SecretValue.unsafePlainText(""),
            },
        });
        NagSuppressions.addResourceSuppressions(livekitSecret, [
            {
                id: "AwsSolutions-SMG4",
                reason: "LiveKit Cloud credentials are managed in the LiveKit console, not rotatable via Secrets Manager.",
            },
        ]);

        // ─── Networking ────────────────────────────────────────────────
        // Public subnets + public IP for egress (no NAT gateway cost). The
        // worker only dials OUT (LiveKit Cloud, Bedrock, Cognito, SSM,
        // Secrets Manager); the security group opens no inbound ports.
        const vpcFlowLogGroup = new LogGroup(this, "VpcFlowLogs", {
            retention: RetentionDays.ONE_WEEK,
            removalPolicy: RemovalPolicy.DESTROY,
        });
        const vpc = new Vpc(this, "Vpc", {
            maxAzs: 2,
            natGateways: 0,
            subnetConfiguration: [{ name: "public", subnetType: SubnetType.PUBLIC, cidrMask: 24 }],
            flowLogs: {
                cloudwatch: {
                    destination: FlowLogDestination.toCloudWatchLogs(vpcFlowLogGroup),
                    trafficType: FlowLogTrafficType.REJECT,
                },
            },
        });

        const workerSg = new SecurityGroup(this, "WorkerSg", {
            vpc,
            description: "LiveKit agent worker - egress only",
            allowAllOutbound: true,
        });
        NagSuppressions.addResourceSuppressions(workerSg, [
            {
                id: "AwsSolutions-EC23",
                reason: "Egress-only security group; no inbound rules are defined.",
            },
        ]);

        const cluster = new Cluster(this, "Cluster", { vpc });
        NagSuppressions.addResourceSuppressions(cluster, [
            {
                id: "AwsSolutions-ECS4",
                reason: "Container Insights not required for the demo LiveKit worker; CloudWatch logs are sufficient.",
            },
        ]);

        // ─── Agent worker task ─────────────────────────────────────────
        const workerImage = new DockerImageAsset(this, "WorkerImage", {
            directory: repoRoot,
            file: "patterns/livekit-agent/Dockerfile",
            platform: Platform.LINUX_ARM64,
        });

        const taskDef = new FargateTaskDefinition(this, "WorkerTask", {
            cpu: cfg.workerCpu,
            memoryLimitMiB: cfg.workerMemory,
            runtimePlatform: {
                cpuArchitecture: CpuArchitecture.ARM64,
                operatingSystemFamily: OperatingSystemFamily.LINUX,
            },
        });

        // Task (application) role — Bedrock + gateway M2M + SSM.
        taskDef.taskRole.addToPrincipalPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "bedrock:InvokeModel",
                    "bedrock:InvokeModelWithBidirectionalStream",
                    "bedrock:InvokeModelWithResponseStream",
                ],
                resources: [
                    `arn:aws:bedrock:*::foundation-model/${models.avatar_sonic}`,
                    `arn:aws:bedrock:*::foundation-model/${models.avatar_tool_selector}`,
                ],
            })
        );
        taskDef.taskRole.addToPrincipalPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["ssm:GetParameter", "ssm:GetParameters"],
                resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${stackName}/*`],
            })
        );
        auth.machineClientSecret.grantRead(taskDef.taskRole);
        livekitSecret.grantRead(taskDef.taskRole);
        // Execution role also reads the secret to inject env vars at start.
        livekitSecret.grantRead(taskDef.obtainExecutionRole());

        const workerLogGroup = new LogGroup(this, "WorkerLogGroup", {
            logGroupName: `/aws/ecs/${stackName}-livekit-worker`,
            retention: RetentionDays.ONE_WEEK,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        taskDef.addContainer("worker", {
            image: ContainerImage.fromDockerImageAsset(workerImage),
            logging: LogDriver.awsLogs({ streamPrefix: "worker", logGroup: workerLogGroup }),
            environment: {
                AWS_REGION: this.region,
                AWS_DEFAULT_REGION: this.region,
                STACK_NAME: stackName,
                MODEL_ID: models.avatar_sonic,
                PERSONA: "friendly",
                VOICE_ID: cfg.voiceId,
                LOGLEVEL: "INFO",
            },
            secrets: {
                LIVEKIT_URL: EcsSecret.fromSecretsManager(livekitSecret, "url"),
                LIVEKIT_API_KEY: EcsSecret.fromSecretsManager(livekitSecret, "api_key"),
                LIVEKIT_API_SECRET: EcsSecret.fromSecretsManager(livekitSecret, "api_secret"),
            },
        });

        NagSuppressions.addResourceSuppressions(taskDef, [
            {
                id: "AwsSolutions-ECS2",
                reason: "Non-sensitive config (region, stack name, model id, persona, log level) is passed as environment variables; the LiveKit credentials are injected via `secrets` from Secrets Manager.",
            },
        ]);

        new FargateService(this, "WorkerService", {
            cluster,
            taskDefinition: taskDef,
            desiredCount: 1,
            assignPublicIp: true,
            vpcSubnets: { subnetType: SubnetType.PUBLIC },
            securityGroups: [workerSg],
            circuitBreaker: { rollback: true },
            minHealthyPercent: 0,
            maxHealthyPercent: 200,
        });

        // ─── Token API (browser → LiveKit access token) ────────────────
        const tokenLambdaDir = path.join(repoRoot, "lambdas", "livekit-token");
        // LogGroup is provided automatically by FunctionLogGroupInjector
        // (see lib/common/blueprints.ts) — do not create one explicitly here
        // or the injected `${id}LogGroup` construct id collides.
        const tokenLambda = new LambdaFunction(this, "TokenLambda", {
            functionName: `${stackName}-livekit-token`,
            runtime: LambdaRuntime.PYTHON_3_13,
            handler: "index.handler",
            architecture: Architecture.ARM_64,
            timeout: Duration.seconds(30),
            environment: {
                LIVEKIT_SECRET_ARN: livekitSecret.secretArn,
                CORS_ALLOWED_ORIGINS: "*",
            },
            code: Code.fromAsset(tokenLambdaDir, {
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
                                // nosemgrep: detect-child-process — CDK-controlled constant paths.
                                cp.execSync(
                                    `python3 -m pip install -r "${path.join(tokenLambdaDir, "requirements.txt")}" -t "${outputDir}" --quiet --no-cache-dir`,
                                    { stdio: "pipe" }
                                );
                                // nosemgrep: detect-child-process — CDK-controlled constant paths.
                                cp.execSync(`cp -r "${tokenLambdaDir}/"* "${outputDir}/"`, {
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
        });
        livekitSecret.grantRead(tokenLambda);

        const api = new apigateway.RestApi(this, "LiveKitTokenApi", {
            restApiName: `${stackName}-livekit-token-api`,
            description: "Mints LiveKit access tokens scoped to the caller's Cognito identity",
            deployOptions: { loggingLevel: apigateway.MethodLoggingLevel.ERROR },
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: ["POST", "OPTIONS"],
                allowHeaders: ["Content-Type", "Authorization"],
            },
        });
        // API Gateway's own 4xx/5xx responses (unmatched route, authorizer
        // reject) do NOT carry CORS headers by default, so the browser reports
        // them as an opaque CORS/NetworkError instead of the real status.
        // Adding CORS to the default responses makes failures debuggable.
        for (const [id, type] of [
            ["Default4xx", apigateway.ResponseType.DEFAULT_4XX],
            ["Default5xx", apigateway.ResponseType.DEFAULT_5XX],
        ] as const) {
            api.addGatewayResponse(`GatewayResponse${id}`, {
                type,
                responseHeaders: {
                    "Access-Control-Allow-Origin": "'*'",
                    "Access-Control-Allow-Headers": "'Content-Type,Authorization'",
                },
            });
        }

        NagSuppressions.addResourceSuppressions(
            api,
            [
                {
                    id: "AwsSolutions-APIG2",
                    reason: "Request validation not required for demo token endpoint.",
                },
                { id: "AwsSolutions-APIG4", reason: "Cognito authorizer used instead of API key." },
                {
                    id: "AwsSolutions-COG4",
                    reason: "Cognito authorizer is applied at method level.",
                },
                { id: "AwsSolutions-APIG1", reason: "Access logging not required for demo." },
            ],
            true
        );

        new CfnWebACLAssociation(this, "TokenApiWafAssociation", {
            resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/stages/${api.deploymentStage.stageName}`,
            webAclArn: auth.regionalWebAclArn,
        });

        const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "TokenApiAuthorizer", {
            cognitoUserPools: [auth.userPool],
        });

        const tokenResource = api.root.addResource("livekit-token");
        tokenResource.addMethod("POST", new apigateway.LambdaIntegration(tokenLambda), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });

        this.tokenApiUrl = api.url;

        new StringParameter(this, "LiveKitTokenApiUrlParam", {
            parameterName: `/${stackName}/livekit_token_api_url`,
            stringValue: api.url,
        });
        new CfnOutput(this, "LiveKitTokenApiUrl", { value: api.url });
    }
}
