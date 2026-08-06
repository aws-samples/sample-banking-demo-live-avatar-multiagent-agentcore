/* eslint-disable @typescript-eslint/no-require-imports */
import { CfnOutput, Duration, RemovalPolicy, StackProps } from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import {
    FlowLogDestination,
    FlowLogTrafficType,
    Port,
    SecurityGroup,
    SubnetType,
    Vpc,
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
} from "aws-cdk-lib/aws-ecs";
import {
    ApplicationLoadBalancer,
    ApplicationProtocol,
    ListenerAction,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
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
import { CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";
import { Stack } from "../../common/constructs/stack";
import { getModelConfig, getStackNameBase, getTavusConfig } from "../../common/feature-flags";
import { Auth } from "../auth";

export interface TavusAvatarProps extends StackProps {
    auth: Auth;
}

const CONTAINER_PORT = 7860;

/**
 * Tavus video-avatar stack (Pipecat + Nova Sonic worker).
 *
 * Parallel to the LiveKit stack (Strategy A): used only when the visitor selects
 * the "Realistic" Tavus variant. The in-account pieces are:
 *   1. A Secrets Manager secret holding Tavus + Daily credentials (empty
 *      placeholders on first deploy — operator populates post-deploy).
 *   2. A Fargate service running the Pipecat + Nova Sonic worker
 *      (patterns/tavus-pipecat-agent). It dials OUT to Bedrock, the AgentCore
 *      Gateway, Tavus, and Daily, so avatar media rides Daily's relay and the
 *      worker needs no public inbound media port (egress-only, like LiveKit).
 *   3. An INTERNAL ALB in front of the worker's signaling/health endpoint.
 *   4. A Cognito-authorized offer API (REST + authorizer + Lambda) the browser
 *      calls; the Lambda injects the verified caller `sub` into the offer so the
 *      worker can scope gateway tools to the caller (tenant isolation).
 *
 * Gated by the `tavus_avatar` feature flag; not instantiated when off.
 */
export class TavusAvatar extends Stack {
    public readonly offerApiUrl: string = "";

    constructor(scope: Construct, id: string, props: TavusAvatarProps) {
        super(scope, id, props);

        const { auth } = props;
        const stackName = getStackNameBase(this.node);
        const models = getModelConfig(this.node);
        const cfg = getTavusConfig(this.node);
        const repoRoot = path.join(__dirname, "..", "..", "..");

        // ─── Tavus + Daily credentials secret (imported, not created) ──
        // The secret is created and populated OUT OF BAND via the AWS CLI, so
        // its value never lives in CloudFormation and it can be stored before
        // this stack is ever deployed. The worker's task role reads it at
        // startup (see tavus_pipecat_agent._load_tavus_secret), rather than ECS
        // injecting individual fields — which also sidesteps the partial-ARN
        // issue with field-level injection on an imported secret.
        //   aws secretsmanager create-secret --name /<stack>/tavus --region <r> \
        //     --secret-string '{"TAVUS_API_KEY":"...","TAVUS_REPLICA_ID":"...",
        //                       "TAVUS_PERSONA_ID":"pipecat-stream","DAILY_API_KEY":"..."}'
        const tavusSecretName = `/${stackName}/tavus`;
        const tavusSecret = Secret.fromSecretNameV2(this, "TavusSecret", tavusSecretName);

        // ─── Networking ────────────────────────────────────────────────
        // Public subnets + public IP for egress (no NAT cost). The worker dials
        // OUT only (Bedrock, gateway, Tavus, Daily); avatar media rides Daily's
        // relay, so there is no inbound media port. The only inbound is the
        // internal ALB → container signaling port.
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

        const albSg = new SecurityGroup(this, "AlbSg", {
            vpc,
            description: "Tavus worker internal ALB",
            allowAllOutbound: true,
        });
        const workerSg = new SecurityGroup(this, "WorkerSg", {
            vpc,
            description: "Tavus Pipecat worker",
            allowAllOutbound: true,
        });
        workerSg.addIngressRule(albSg, Port.tcp(CONTAINER_PORT), "Signaling from internal ALB");
        const offerLambdaSg = new SecurityGroup(this, "OfferLambdaSg", {
            vpc,
            description: "Tavus offer Lambda",
            allowAllOutbound: true,
        });
        albSg.addIngressRule(offerLambdaSg, Port.tcp(80), "Offer Lambda to internal ALB");
        NagSuppressions.addResourceSuppressions(
            [albSg, workerSg, offerLambdaSg],
            [
                {
                    id: "AwsSolutions-EC23",
                    reason: "Ingress is restricted to sibling security groups; no 0.0.0.0/0 inbound.",
                },
            ]
        );

        const cluster = new Cluster(this, "Cluster", { vpc });
        NagSuppressions.addResourceSuppressions(cluster, [
            {
                id: "AwsSolutions-ECS4",
                reason: "Container Insights not required for the demo Tavus worker; CloudWatch logs are sufficient.",
            },
        ]);

        // ─── Worker task ───────────────────────────────────────────────
        const workerImage = new DockerImageAsset(this, "WorkerImage", {
            directory: repoRoot,
            file: "patterns/tavus-pipecat-agent/Dockerfile",
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

        // Bedrock (Nova Sonic bidirectional stream) + gateway M2M + SSM.
        taskDef.taskRole.addToPrincipalPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "bedrock:InvokeModel",
                    "bedrock:InvokeModelWithBidirectionalStream",
                    "bedrock:InvokeModelWithResponseStream",
                ],
                resources: [`arn:aws:bedrock:*::foundation-model/${models.avatar_sonic}`],
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
        // The task role reads the Tavus secret at runtime (boto3), not ECS field
        // injection — so only the task role needs read, not the execution role.
        tavusSecret.grantRead(taskDef.taskRole);

        const workerLogGroup = new LogGroup(this, "WorkerLogGroup", {
            logGroupName: `/aws/ecs/${stackName}-tavus-worker`,
            retention: RetentionDays.ONE_WEEK,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        taskDef.addContainer("worker", {
            image: ContainerImage.fromDockerImageAsset(workerImage),
            logging: LogDriver.awsLogs({ streamPrefix: "worker", logGroup: workerLogGroup }),
            portMappings: [{ containerPort: CONTAINER_PORT }],
            environment: {
                AWS_REGION: this.region,
                AWS_DEFAULT_REGION: this.region,
                STACK_NAME: stackName,
                MODEL_ID: models.avatar_sonic,
                PERSONA: "friendly",
                VOICE_ID: cfg.novaSonicVoiceId,
                LOGLEVEL: "INFO",
                // The worker reads the Tavus/Daily credentials from this secret
                // at startup via boto3 (see _load_tavus_secret). The secret is
                // created out of band, so nothing sensitive is in this template.
                TAVUS_SECRET_NAME: tavusSecretName,
            },
        });
        NagSuppressions.addResourceSuppressions(taskDef, [
            {
                id: "AwsSolutions-ECS2",
                reason: "Only non-sensitive config is passed as environment variables; the Tavus/Daily secret is read at runtime by the task role from Secrets Manager, not embedded here.",
            },
        ]);

        const service = new FargateService(this, "WorkerService", {
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

        // ─── Internal ALB in front of the worker ───────────────────────
        const alb = new ApplicationLoadBalancer(this, "WorkerAlb", {
            vpc,
            internetFacing: false,
            securityGroup: albSg,
            vpcSubnets: { subnetType: SubnetType.PUBLIC },
        });
        const listener = alb.addListener("Listener", {
            port: 80,
            protocol: ApplicationProtocol.HTTP,
            defaultAction: ListenerAction.fixedResponse(404, {
                contentType: "application/json",
                messageBody: '{"error":"not found"}',
            }),
        });
        listener.addTargets("Worker", {
            port: CONTAINER_PORT,
            protocol: ApplicationProtocol.HTTP,
            targets: [service],
            healthCheck: {
                path: "/health",
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 5,
                interval: Duration.seconds(15),
            },
            deregistrationDelay: Duration.seconds(30),
        });
        NagSuppressions.addResourceSuppressions(
            alb,
            [
                {
                    id: "AwsSolutions-ELB2",
                    reason: "Access logging not required for the internal demo ALB; CloudWatch covers the worker.",
                },
                {
                    id: "AwsSolutions-EC23",
                    reason: "Internal ALB; ingress is restricted to the offer Lambda security group.",
                },
            ],
            true
        );

        // ─── Offer API (browser → verified offer → worker) ──────────────
        const offerLambdaDir = path.join(repoRoot, "lambdas", "tavus-offer");
        const offerLambda = new LambdaFunction(this, "OfferLambda", {
            functionName: `${stackName}-tavus-offer`,
            runtime: LambdaRuntime.PYTHON_3_13,
            handler: "index.handler",
            architecture: Architecture.ARM_64,
            timeout: Duration.seconds(30),
            vpc,
            vpcSubnets: { subnetType: SubnetType.PUBLIC },
            securityGroups: [offerLambdaSg],
            allowPublicSubnet: true,
            environment: {
                WORKER_CONNECT_URL: `http://${alb.loadBalancerDnsName}/start`,
                CORS_ALLOWED_ORIGINS: "*",
                DEFAULT_PERSONA: "friendly",
            },
            code: Code.fromAsset(offerLambdaDir, {
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
                                    `python3 -m pip install -r "${path.join(offerLambdaDir, "requirements.txt")}" -t "${outputDir}" --quiet --no-cache-dir`,
                                    { stdio: "pipe" }
                                );
                                // nosemgrep: detect-child-process — CDK-controlled constant paths.
                                cp.execSync(`cp -r "${offerLambdaDir}/"* "${outputDir}/"`, {
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
        NagSuppressions.addResourceSuppressions(
            offerLambda,
            [
                {
                    id: "AwsSolutions-IAM4",
                    reason: "Lambda VPC + basic execution managed policies are standard for a VPC-attached function.",
                },
                {
                    id: "AwsSolutions-IAM5",
                    reason: "VPC ENI permissions require wildcards by design.",
                },
            ],
            true
        );

        const api = new apigateway.RestApi(this, "TavusOfferApi", {
            restApiName: `${stackName}-tavus-offer-api`,
            description:
                "Cognito-authorized offer proxy that injects the verified caller into the Tavus worker session",
            deployOptions: { loggingLevel: apigateway.MethodLoggingLevel.ERROR },
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: ["POST", "OPTIONS"],
                allowHeaders: ["Content-Type", "Authorization"],
            },
        });
        for (const [rid, type] of [
            ["Default4xx", apigateway.ResponseType.DEFAULT_4XX],
            ["Default5xx", apigateway.ResponseType.DEFAULT_5XX],
        ] as const) {
            api.addGatewayResponse(`GatewayResponse${rid}`, {
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
                    reason: "Request validation not required for the demo offer endpoint.",
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

        new CfnWebACLAssociation(this, "OfferApiWafAssociation", {
            resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/stages/${api.deploymentStage.stageName}`,
            webAclArn: auth.regionalWebAclArn,
        });

        const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "OfferApiAuthorizer", {
            cognitoUserPools: [auth.userPool],
        });
        const offerResource = api.root.addResource("tavus-offer");
        offerResource.addMethod("POST", new apigateway.LambdaIntegration(offerLambda), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });

        this.offerApiUrl = api.url;
        new StringParameter(this, "TavusOfferApiUrlParam", {
            parameterName: `/${stackName}/tavus_offer_api_url`,
            stringValue: api.url,
        });
        new CfnOutput(this, "TavusOfferApiUrl", { value: api.url });
    }
}
