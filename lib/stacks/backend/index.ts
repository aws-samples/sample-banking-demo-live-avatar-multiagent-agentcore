/* eslint-disable @typescript-eslint/no-require-imports */
import {
    Aws,
    CfnOutput,
    CfnResource,
    CustomResource,
    Duration,
    RemovalPolicy,
    StackProps,
} from "aws-cdk-lib";
import { Provider } from "aws-cdk-lib/custom-resources";
import { CfnGuardrail } from "aws-cdk-lib/aws-bedrock";
import {
    CfnGateway,
    CfnGatewayTarget,
    CfnPolicy,
    CfnPolicyEngine,
    CfnRuntime,
} from "aws-cdk-lib/aws-bedrockagentcore";
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
    LayerVersion,
    Runtime as LambdaRuntime,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as fs from "fs";
import * as path from "path";
import { Stack } from "../../common/constructs/stack";
import {
    getFeatureFlags,
    getModelConfig,
    getSageMakerConfig,
    getStackNameBase,
} from "../../common/feature-flags";
import { createAgentCoreRole } from "./agentcore-role";
import { createIdentityProvider } from "./identity-provider";
import { createWebSearchConnectorTarget } from "./web-search-target";
import { Auth } from "../auth";
import { Shared } from "../shared";

export interface BackendProps extends StackProps {
    auth: Auth;
    shared: Shared;
}

export class Backend extends Stack {
    // One dedicated orchestrator runtime per agent experience. They share a
    // single container image (the mode-routing orchestrator) but are separate
    // AgentCore Runtimes so each agent is independently listed, scaled, and
    // observable in the console.
    public readonly researchRuntimeArn: string = "";
    public readonly assistantRuntimeArn: string = "";
    public readonly agentRuntimeArn: string = "";
    /** Back-compat alias — points at the Deep Research runtime. */
    public readonly orchestratorRuntimeArn: string = "";
    public readonly avatarRuntimeArn: string = "";
    public readonly feedbackApiUrl: string = "";
    public readonly gatewayUrl: string = "";

    constructor(scope: Construct, id: string, props: BackendProps) {
        super(scope, id, props);

        const { auth, shared } = props;
        const features = getFeatureFlags(this.node);
        const models = getModelConfig(this.node);
        const sagemaker = getSageMakerConfig(this.node);
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
            fraudClientSecretArn: auth.fraudMachineClientSecret?.secretArn,
            enablePromptOptimization: features.prompt_optimization,
            enableSagemakerModel: features.sagemaker_model,
            sagemakerEndpointName: sagemaker.endpointName,
            sagemakerInferenceComponentName: sagemaker.inferenceComponentName,
            enableAgentCoreIdentity: features.agentcore_identity,
            enableManagedEval: features.bedrock_managed_eval,
            enableAgentCoreEval: features.agentcore_evaluation,
        });

        // ─── AgentCore Identity credential provider (flag-gated) ────────
        // Stores the Gateway's Cognito M2M client credentials in the Identity
        // token vault so agents mint Gateway tokens through Identity instead of
        // calling Cognito directly. `identityProviderName` rides into each
        // runtime's env; utils/auth.py uses it with automatic fallback.
        let identityProviderName: string | undefined;
        if (features.agentcore_identity) {
            const identity = createIdentityProvider(this, {
                stackName,
                discoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${auth.userPool.userPoolId}/.well-known/openid-configuration`,
                clientIdParam: `/${stackName}/machine_client_id`,
                clientSecretName: `/${stackName}/machine_client_secret`,
                clientSecretArn: auth.machineClientSecret.secretArn,
            });
            identityProviderName = identity.providerName;
        }
        // Per-runtime env for the Identity token path. The workload name is the
        // runtime's own name — AgentCore auto-creates a workload identity per
        // runtime under that name.
        const identityEnvFor = (runtimeName: string): Record<string, string> =>
            features.agentcore_identity && identityProviderName
                ? {
                      AGENTCORE_IDENTITY_PROVIDER: identityProviderName,
                      AGENTCORE_WORKLOAD_NAME: runtimeName,
                  }
                : {};
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

        // Shared AgentCore Memory access for the memory reader tools. Attached
        // below; see that loop for why this is a layer rather than a copy per tool.
        const memoryLayer = new LayerVersion(this, "AgentCoreMemoryLayer", {
            layerVersionName: `${stackName}-agentcore-memory`,
            code: Code.fromAsset(path.join(repoRoot, "gateway", "layers", "memory"), {
                // Running the test suite imports this module, so without the
                // exclusion local bytecode ships in the layer and changes the
                // asset hash between machines.
                exclude: ["__pycache__", "*.pyc"],
            }),
            compatibleRuntimes: [LambdaRuntime.PYTHON_3_13],
            compatibleArchitectures: [Architecture.ARM_64],
            description: "Namespace resolution and short/long-term reads for AgentCore Memory",
            removalPolicy: RemovalPolicy.DESTROY,
        });

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

        // Pass memory IDs to tool Lambdas (used by recall_memories).
        // CreateEvent takes no strategy ID — strategies process events
        // asynchronously into records under the namespaces configured above.
        // Retrieval does need those namespaces, and there is no shared
        // `/actors/{user_id}/` namespace to read from: the configured paths all
        // begin `/strategies/{memoryStrategyId}/`, and `namespace` on
        // RetrieveMemoryRecords matches by prefix. recall_memories therefore
        // resolves the generated strategy IDs at call time via GetMemory.
        // See docs/kb-isolation.md for the broader memory architecture notes.
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
            {
                dir: "image_generate",
                handler: "handler.handler",
                timeout: 300,
                memory: 512,
                // Text-to-image via Stability SD3.5 Large, invoked cross-region in
                // us-west-2 (Amazon Nova Canvas is LEGACY and refused by Bedrock in
                // this account). IAM below already allows bedrock:InvokeModel on "*",
                // so the cross-region call is permitted.
                extraEnv: {
                    IMAGE_MODEL_ID: "stability.sd3-5-large-v1:0",
                    IMAGE_MODEL_REGION: "us-west-2",
                },
            },
            { dir: "image_history", handler: "handler.handler", timeout: 60, memory: 128 },
            { dir: "recall_memories", handler: "handler.handler", timeout: 300, memory: 256 },
            { dir: "analyze_patterns", handler: "handler.handler", timeout: 300, memory: 256 },
            { dir: "retrieve_user_profile", handler: "handler.handler", timeout: 60, memory: 128 },
            { dir: "open_account", handler: "handler.handler", timeout: 300, memory: 256 },
            { dir: "data_sources", handler: "handler.handler", timeout: 30, memory: 128 },
            { dir: "website_generator", handler: "handler.handler", timeout: 900, memory: 512 },
            { dir: "extract_pdf_images", handler: "handler.handler", timeout: 900, memory: 256 },
        ];

        // sample_tool is a word-counter demo. Off by default — enable via
        // `features.sample_tool` in cdk.json only when you actually want a
        // throwaway tool registered with the live Gateway (e.g. when
        // teaching the tool-registration loop).
        if (features.sample_tool) {
            toolDefs.push({
                dir: "sample_tool",
                handler: "sample_tool_lambda.handler",
                timeout: 300,
                memory: 128,
            });
        }

        // When the managed Web Search Tool connector is enabled, the custom
        // Nova-grounding web_search Lambda is replaced by the connector target
        // below — skip creating the Lambda (and therefore its target) so the
        // two implementations never both register a web-search tool.
        const effectiveToolDefs = features.managed_web_search
            ? toolDefs.filter((d) => d.dir !== "web_search")
            : toolDefs;

        for (const def of effectiveToolDefs) {
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
                                      // Every interpolated path MUST stay quoted — a checkout
                                      // directory containing spaces otherwise fragments the
                                      // arguments, pip fails, and CDK silently falls back to
                                      // Docker bundling.
                                      const requirements = path.join(toolDir, "requirements.txt");
                                      // nosemgrep: detect-child-process
                                      // CDK asset bundling: `outputDir` is a CDK-generated temp path,
                                      // `toolDir` is a compile-time constant under gateway/tools/.
                                      cp.execSync(
                                          `python3 -m pip install -r "${requirements}" -t "${outputDir}" --quiet --no-cache-dir --platform manylinux2014_aarch64 --only-binary :all: --implementation cp --python-version 3.13`,
                                          { stdio: "pipe" }
                                      );
                                      // nosemgrep: detect-child-process
                                      // Same rationale as above — CDK-controlled paths only.
                                      cp.execSync(`cp -r "${toolDir}/"* "${outputDir}/"`, {
                                          stdio: "pipe",
                                          shell: "/bin/bash",
                                      });
                                      return true;
                                  } catch (err) {
                                      // Surface the reason. Returning false silently sends CDK to
                                      // Docker, which turns a local tooling problem into a
                                      // confusing image-pull failure much later in the synth.
                                      const reason =
                                          err instanceof Error ? err.message : String(err);
                                      console.warn(
                                          `[bundling] local bundle failed for ${def.dir}, falling back to Docker: ${reason}`
                                      );
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

        // Grant AgentCore Memory permissions to memory tool Lambdas, and give the
        // readers the shared `agentcore_memory` module. A layer rather than a copy
        // per tool: each tool bundles only its own directory, and the namespace
        // logic in that module was already wrong once in a way that returned empty
        // results instead of errors — two copies drifting would silently disable
        // retrieval on one path.
        for (const memToolDir of ["recall_memories", "analyze_patterns"]) {
            const memFn = toolLambdas[memToolDir];
            if (!memFn) continue;

            memFn.addToRolePolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        "bedrock-agentcore:RetrieveMemoryRecords",
                        "bedrock-agentcore:ListMemoryRecords",
                        "bedrock-agentcore:CreateEvent",
                        "bedrock-agentcore:GetEvent",
                        "bedrock-agentcore:ListEvents",
                        "bedrock-agentcore:ListSessions",
                        // The readers resolve the strategies' real namespaces at
                        // call time, because `namespace` is a strict prefix filter
                        // and the strategy IDs are generated at deploy time.
                        "bedrock-agentcore:GetMemory",
                    ],
                    resources: [memoryArn],
                })
            );

            memFn.addLayers(memoryLayer);
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
                    // The shared machine client plus, when the A2A fraud hop is
                    // enabled, the fraud agent's own client so it reaches the
                    // Gateway as a distinct principal (Req 7.4).
                    allowedClients: [
                        auth.machineClient.userPoolClientId,
                        ...(features.a2a && auth.fraudMachineClient
                            ? [auth.fraudMachineClient.userPoolClientId]
                            : []),
                    ],
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

        // ─── Managed Web Search Tool connector (flag-gated) ────────────
        // The AWS-managed Web Search Tool built-in connector, pinned to v1.2.0.
        // Replaces the custom Nova-grounding Lambda (skipped above) with a fully
        // managed MCP web-search tool backed by an Amazon-operated web index —
        // queries never leave AWS. Governance is configured at the Gateway:
        //   - target-level domain EXCLUDE list (deny-list) applied to every
        //     query, hidden from the agent;
        //   - v1.2.0 also enables per-request domain include/exclude and a
        //     published-date bound the agent applies for compliance queries.
        // A target-level INCLUDE (allow) list is intentionally NOT set: it would
        // restrict EVERY query to those domains and break the research agent's
        // open-web research, so the regulator allow-list is a per-query filter.
        if (features.managed_web_search) {
            const webSearchCfg =
                (this.node.tryGetContext("webSearch") as
                    | { excludeDomains?: string[] }
                    | undefined) ?? {};
            const excludeDomains = Array.isArray(webSearchCfg.excludeDomains)
                ? webSearchCfg.excludeDomains
                : [];

            // Doc: the Gateway service role must allow InvokeGateway and, for the
            // web-search connector, InvokeWebSearch on the service-owned tool ARN.
            gatewayRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["bedrock-agentcore:InvokeGateway"],
                    resources: [
                        `arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway/*`,
                    ],
                })
            );
            gatewayRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["bedrock-agentcore:InvokeWebSearch"],
                    // Account field is literally `aws` — this is a service-owned tool ARN.
                    resources: [`arn:aws:bedrock-agentcore:${this.region}:aws:tool/web-search.v1`],
                })
            );

            // The `connector` MCP target type is newer than the
            // `AWS::BedrockAgentCore::GatewayTarget` CloudFormation resource
            // spec (the L1 silently drops the key, rendering `Mcp: {}`), so the
            // connector target is provisioned by a Lambda-backed custom resource
            // calling `bedrock-agentcore-control` directly — the same pattern
            // this stack already uses for the Agent Registry and Identity
            // credential provider. Empirically verified: create_gateway_target
            // with this exact shape reaches READY.
            createWebSearchConnectorTarget(this, {
                stackName,
                gatewayId: gateway.attrGatewayIdentifier,
                connectorVersion: "1.2.0",
                excludeDomains,
            });
        }

        this.gatewayUrl = gateway.attrGatewayUrl;

        // ─── AgentCore Policy engine (Cedar, on the Gateway) ───────────
        // A policy engine associated with the Gateway intercepts EVERY agent
        // tool call and authorizes it against Cedar policies before the tool
        // runs — deterministic control the agent cannot reason its way around.
        //
        // Ships in LOG_ONLY: it records allow/deny traces on real traffic
        // without enforcing. That is the AWS-recommended path (validate on live
        // traffic first) and it is also a safety requirement here — Cedar is
        // default-deny, and because all three orchestrator runtimes currently
        // call the Gateway as the same machine (OAuth) principal, an ENFORCE
        // flip needs a complete permit set plus per-agent workload identities
        // first. Do not set policyMode:"ENFORCE" until those exist.
        if (features.policy) {
            const gatewayArn = gateway.attrGatewayArn;

            // The engine must NOT depend on the gateway: the gateway takes a
            // dependency on the engine (via policyEngineConfiguration below), so
            // an engine→gateway dependency here would form a cycle. The policies
            // reference the gateway ARN as a plain string, which is enough.
            const policyEngine = new CfnPolicyEngine(this, "PolicyEngine", {
                name: `${stackName.replace(/-/g, "_")}_policy_engine`,
                description: `Cedar authorization for the ${stackName} Gateway tool calls`,
            });

            // The Gateway's service role must be able to read the policy engine
            // it is associated with — AgentCore checks this at association time
            // (GetPolicyEngine) and uses it to evaluate tool calls. Without it
            // the Gateway update fails with "Access denied while calling
            // GetPolicyEngine ... Confirm this role has ... permissions".
            // The Gateway's role must read AND evaluate the policy engine. The
            // association's "GenesisPolicyEngineCheck" and runtime evaluation
            // call a family of authorization actions (GetPolicyEngine,
            // AuthorizeAction, PartiallyAuthorizeActions, …) whose resource
            // varies — the engine ARN for reads, the GATEWAY ARN for the
            // authorize calls. Rather than chase each action/resource pair
            // through failed deploys, grant the bedrock-agentcore family for
            // this service role. It is a Gateway-only service principal in a dev
            // account (already broadly scoped for Bedrock), and the IAM5 nag is
            // suppressed on this role. Tighten to the exact action set once the
            // preview API's required permissions are documented.
            gatewayRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["bedrock-agentcore:*"],
                    resources: ["*"],
                })
            );

            // Baseline allow: authenticated agents may call Gateway tools. This
            // is the permit root an ENFORCE posture builds on (without it,
            // default-deny would block everything the moment enforcement is on).
            const permitBaseline = new CfnPolicy(this, "PolicyPermitGatewayTools", {
                policyEngineId: policyEngine.attrPolicyEngineId,
                name: "permit_gateway_tools",
                description: "Baseline: authenticated agents may invoke Gateway tools.",
                // Cedar analyzer findings are ignored so the policy deploys even
                // before the tool schema is fully resolved; LOG_ONLY keeps it safe.
                validationMode: "IGNORE_ALL_FINDINGS",
                definition: {
                    cedar: {
                        statement: [
                            "permit (",
                            "  principal,",
                            "  action,",
                            `  resource == AgentCore::Gateway::"${gatewayArn}"`,
                            ");",
                        ].join("\n"),
                    },
                },
            });
            permitBaseline.node.addDependency(policyEngine);

            // Deny the account-opening and customer-PII tools. In LOG_ONLY this
            // surfaces "would-deny" traces demonstrating deterministic tool
            // gating; on ENFORCE (once agents carry distinct identities) it
            // keeps research agents away from write/PII actions that only the
            // customer-facing AI Agent should reach.
            // When the A2A fraud hop is enabled, bind the deny to the fraud
            // agent's OWN principal so the restriction is attributable to it
            // and, under ENFORCE, the account-opening AI Agent keeps its
            // open_account access (Req 7.2). The Gateway's Cedar principal is
            // `AgentCore::OAuthUser`, built from the token `sub`; for a Cognito
            // client-credentials token the `sub` is the app client id. When the
            // fraud hop is off, the original unscoped forbid is kept so the
            // LOG_ONLY "would-deny" demonstration still fires for every caller.
            const fraudClientId =
                features.a2a && auth.fraudMachineClient
                    ? auth.fraudMachineClient.userPoolClientId
                    : undefined;
            const forbidPrincipalClause = fraudClientId
                ? `  principal == AgentCore::OAuthUser::"${fraudClientId}",`
                : "  principal,";

            const forbidSensitive = new CfnPolicy(this, "PolicyDenySensitiveTools", {
                policyEngineId: policyEngine.attrPolicyEngineId,
                name: "deny_account_and_pii_tools",
                description: fraudClientId
                    ? "Deny account-opening and customer-profile tools to the fraud agent principal (deterministic tool gating)."
                    : "Deny account-opening and customer-profile tools (deterministic tool gating).",
                validationMode: "IGNORE_ALL_FINDINGS",
                definition: {
                    cedar: {
                        statement: [
                            "forbid (",
                            forbidPrincipalClause,
                            "  action in [",
                            '    AgentCore::Action::"open-account___open_account",',
                            '    AgentCore::Action::"retrieve-user-profile___retrieve_user_profile"',
                            "  ],",
                            `  resource == AgentCore::Gateway::"${gatewayArn}"`,
                            ");",
                        ].join("\n"),
                    },
                },
            });
            forbidSensitive.node.addDependency(policyEngine);

            // Associate the engine with the Gateway. LOG_ONLY by default.
            gateway.policyEngineConfiguration = {
                arn: policyEngine.attrPolicyEngineArn,
                mode: features.policyMode,
            };

            // Ensure the Gateway role's GetPolicyEngine permission is attached
            // BEFORE the Gateway association is updated, or the update races the
            // policy grant and fails the access check.
            const gwDefaultPolicy = gatewayRole.node.tryFindChild("DefaultPolicy")?.node
                .defaultChild as CfnResource | undefined;
            if (gwDefaultPolicy) {
                gateway.addDependency(gwDefaultPolicy);
            }

            new StringParameter(this, "PolicyEngineArn", {
                parameterName: `/${stackName}/policy_engine_arn`,
                stringValue: policyEngine.attrPolicyEngineArn,
            });

            new CfnOutput(this, "PolicyEngineArn_Output", {
                value: policyEngine.attrPolicyEngineArn,
                description: `AgentCore Policy engine (${features.policyMode}) for the Gateway`,
            });
        }

        new StringParameter(this, "GatewayUrlParam", {
            parameterName: `/${stackName}/gateway_url`,
            stringValue: gateway.attrGatewayUrl,
        });

        // ─── AgentCore Harness (managed agent, via custom resource) ────
        // An additive, customer-facing "Quick Assistant" built on the config-only
        // Harness path (model + system prompt, managed loop) so the Harness
        // console page shows a real managed agent alongside the Runtime agents.
        // There is no CloudFormation resource for Harness, so a small custom
        // resource calls the preview `bedrock-agentcore-control` API. It is
        // BEST-EFFORT: if the preview API is unavailable/denied in the account,
        // the deploy still succeeds and the entry simply does not appear.
        if (features.harness) {
            // Fixed harness name (was `${stackName}_quick_assistant`). Must satisfy
            // the CreateHarness constraint ^[a-zA-Z][a-zA-Z0-9_]{0,39}$.
            const harnessName = "trinityresearch_trinity_research".slice(0, 40);
            const harnessSystemPrompt =
                "You are the Trinity Reserve Bank Quick Assistant, a friendly customer-facing " +
                "helper. Answer questions about the bank's accounts, cards, investing and " +
                "retirement services clearly and concisely. If you are unsure, say so and " +
                "suggest contacting the bank. Never invent account details, rates, or figures.";

            // The harness needs its OWN execution role. It validates that the
            // role's trust policy allows assumption by bedrock-agentcore ONLY —
            // reusing the shared agentCoreRole (which also trusts
            // bedrock.amazonaws.com) fails role validation. Permissions follow
            // the AgentCore harness sample execution-role policy.
            const harnessRole = new Role(this, "HarnessExecutionRole", {
                roleName: `${stackName}-harness-role`,
                assumedBy: new ServicePrincipal("bedrock-agentcore.amazonaws.com"),
                description: "Execution role for the AgentCore Harness Quick Assistant",
            });
            harnessRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        "bedrock:InvokeModel",
                        "bedrock:InvokeModelWithResponseStream",
                        "logs:CreateLogGroup",
                        "logs:CreateLogStream",
                        "logs:PutLogEvents",
                        "logs:DescribeLogStreams",
                        "logs:DescribeLogGroups",
                        "logs:PutResourcePolicy",
                        "xray:PutTraceSegments",
                        "xray:PutTelemetryRecords",
                        "xray:GetSamplingRules",
                        "xray:GetSamplingTargets",
                        "ecr-public:GetAuthorizationToken",
                        "sts:GetServiceBearerToken",
                        "bedrock-agentcore:GetWorkloadAccessToken",
                        "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
                    ],
                    resources: ["*"],
                })
            );
            harnessRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["cloudwatch:PutMetricData"],
                    resources: ["*"],
                    conditions: {
                        StringEquals: { "cloudwatch:namespace": "bedrock-agentcore" },
                    },
                })
            );
            NagSuppressions.addResourceSuppressions(
                harnessRole,
                [
                    {
                        id: "AwsSolutions-IAM5",
                        reason: "Harness execution role uses wildcard resources per the AgentCore harness sample policy (Bedrock model invocation, logs, X-Ray, managed image pull).",
                    },
                ],
                true
            );

            const harnessFn = new LambdaFunction(this, "HarnessProvisioner", {
                functionName: `${stackName}-harness-provisioner`,
                runtime: LambdaRuntime.PYTHON_3_13,
                architecture: Architecture.ARM_64,
                handler: "index.on_event",
                timeout: Duration.minutes(5),
                memorySize: 256,
                // Vendors a recent boto3 — the Harness control-plane API is newer
                // than the runtime-bundled SDK. boto3/botocore are pure-Python so
                // the bundle is architecture-independent.
                code: Code.fromAsset(path.join(repoRoot, "lib", "lambdas", "harness-provisioner"), {
                    bundling: {
                        image: LambdaRuntime.PYTHON_3_13.bundlingImage,
                        command: [
                            "bash",
                            "-c",
                            "pip install -r requirements.txt -t /asset-output && cp -r . /asset-output",
                        ],
                    },
                }),
                environment: {
                    HARNESS_NAME: harnessName,
                    EXECUTION_ROLE_ARN: harnessRole.roleArn,
                    SYSTEM_PROMPT: harnessSystemPrompt,
                },
            });

            // CreateHarness/UpdateHarness/DeleteHarness each also require the
            // underlying AgentRuntime (and Memory) action — see the AgentCore
            // harness "required IAM actions" table — so the provisioner needs
            // both the harness actions and their runtime/memory counterparts.
            // CreateHarness fans out to the underlying AgentRuntime, its DEFAULT
            // AgentRuntimeEndpoint, and Memory. Rather than enumerate each
            // fan-out action (CreateAgentRuntime, CreateAgentRuntimeEndpoint,
            // CreateMemory, and their update/delete counterparts) and rediscover
            // them through failed provisioning, grant the bedrock-agentcore
            // family to this deploy-time custom-resource role.
            harnessFn.addToRolePolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["bedrock-agentcore:*"],
                    resources: ["*"],
                })
            );
            // Passing the dedicated execution role to the harness requires PassRole.
            harnessFn.addToRolePolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["iam:PassRole"],
                    resources: [harnessRole.roleArn],
                    conditions: {
                        StringEquals: {
                            "iam:PassedToService": "bedrock-agentcore.amazonaws.com",
                        },
                    },
                })
            );

            const harnessProvider = new Provider(this, "HarnessProvider", {
                onEventHandler: harnessFn,
            });

            const harnessResource = new CustomResource(this, "HarnessResource", {
                serviceToken: harnessProvider.serviceToken,
                properties: {
                    // Re-provision when the identity, prompt, or this rev changes.
                    HarnessName: harnessName,
                    PromptHash: harnessSystemPrompt.length.toString(),
                    // Bump to force the custom resource to re-run (e.g. after
                    // switching to the dedicated execution role / fixing perms).
                    Rev: "3",
                },
            });
            harnessResource.node.addDependency(harnessRole);

            new CfnOutput(this, "HarnessArn_Output", {
                value: harnessResource.getAttString("HarnessArn"),
                description:
                    "AgentCore Harness ARN (Quick Assistant); empty if the preview API was unavailable",
            });

            // The provisioner needs wildcard bedrock-agentcore + PassRole; the
            // Provider framework brings its own managed-runtime Lambda + role.
            NagSuppressions.addResourceSuppressions(
                harnessFn,
                [
                    {
                        id: "AwsSolutions-IAM5",
                        reason: "Harness provisioner needs bedrock-agentcore:* on * (harness ARNs are created at runtime) and PassRole on the AgentCore role.",
                    },
                ],
                true
            );
            NagSuppressions.addResourceSuppressions(
                harnessProvider,
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

        // ─── AgentCore Evaluations (custom resource, feature-gated) ────
        // Provisions a custom LLM-as-a-judge evaluator + an online evaluation
        // config that scores the AI Assistant runtime's live spans (from the
        // shared `aws/spans` log group, filtered by service name). This makes
        // the AgentCore console's "Custom evaluators" and "Evaluation
        // configurations" tabs show real, app-tied entries and starts scoring
        // sessions in Observability — the foundation for the AgentCore
        // evaluation / optimization / A-B story. There is no CloudFormation
        // resource for Evaluations, so a small custom resource calls the preview
        // `bedrock-agentcore-control` API. BEST-EFFORT: if the preview API is
        // unavailable/denied, the deploy still succeeds and the entries simply
        // do not appear. Requires per-runtime Tracing + Transaction Search on
        // (so spans exist) — enabled out of band.
        if (features.agentcore_evaluation) {
            // The online-eval scores the AI Assistant runtime. The OTEL service
            // name AgentCore emits is `<runtime_name>.DEFAULT`.
            const assistantServiceName = `${stackName.replace(/-/g, "_")}_ai_assistant.DEFAULT`;

            // Execution role AgentCore assumes to run the evaluation: read the
            // spans, write results to its own results log group, and invoke the
            // judge model. Trusts ONLY bedrock-agentcore (role validation
            // rejects the shared agentCoreRole, which also trusts bedrock).
            const evalExecutionRole = new Role(this, "EvalExecutionRole", {
                roleName: `${stackName}-eval-exec-role`,
                assumedBy: new ServicePrincipal("bedrock-agentcore.amazonaws.com"),
                description: "Execution role for AgentCore online evaluation of the AI Assistant",
            });
            evalExecutionRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        "logs:StartQuery",
                        "logs:GetQueryResults",
                        "logs:FilterLogEvents",
                        "logs:GetLogEvents",
                        "logs:DescribeLogGroups",
                    ],
                    resources: ["*"],
                })
            );
            evalExecutionRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    // The service creates a per-config results log group under
                    // this prefix and writes evaluation results to it.
                    actions: [
                        "logs:CreateLogGroup",
                        "logs:CreateLogStream",
                        "logs:PutLogEvents",
                        "logs:DescribeLogStreams",
                    ],
                    resources: [
                        `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/evaluations/*`,
                    ],
                })
            );
            evalExecutionRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["bedrock:InvokeModel"],
                    resources: ["*"],
                })
            );
            NagSuppressions.addResourceSuppressions(
                evalExecutionRole,
                [
                    {
                        id: "AwsSolutions-IAM5",
                        reason: "Evaluation execution role reads spans (log group names are dynamic) and invokes the judge model; scoped to the evaluations results log-group prefix where possible.",
                    },
                ],
                true
            );

            const evalProvisionerFn = new LambdaFunction(this, "EvalProvisioner", {
                functionName: `${stackName}-eval-provisioner`,
                runtime: LambdaRuntime.PYTHON_3_13,
                architecture: Architecture.ARM_64,
                handler: "index.on_event",
                timeout: Duration.minutes(10),
                memorySize: 256,
                // Vendors a recent boto3 — the Evaluations control-plane API is
                // newer than the runtime-bundled SDK. Pure-Python, so the bundle
                // is architecture-independent.
                code: Code.fromAsset(
                    path.join(repoRoot, "lib", "lambdas", "agentcore-eval-provisioner"),
                    {
                        bundling: {
                            image: LambdaRuntime.PYTHON_3_13.bundlingImage,
                            command: [
                                "bash",
                                "-c",
                                "pip install -r requirements.txt -t /asset-output && cp -r . /asset-output",
                            ],
                        },
                    }
                ),
                environment: {
                    EVALUATOR_NAME: `${stackName.replace(/-/g, "_")}_copy_quality`,
                    ONLINE_EVAL_NAME: `${stackName.replace(/-/g, "_")}_ai_assistant_eval`,
                    JUDGE_MODEL_ID: "us.amazon.nova-pro-v1:0",
                    EXECUTION_ROLE_ARN: evalExecutionRole.roleArn,
                    SPANS_LOG_GROUP: "aws/spans",
                    SERVICE_NAMES: assistantServiceName,
                    SAMPLING_PERCENTAGE: "100",
                    SESSION_TIMEOUT_MINUTES: "5",
                },
            });

            // The provisioner creates/deletes evaluator + online-eval resources
            // (ARNs minted at runtime) and passes the execution role to the
            // service. Grant the eval control-plane family + scoped PassRole.
            // The evaluator/online-eval control-plane actions (and any fan-out
            // they trigger) — grant the bedrock-agentcore family rather than
            // enumerate exact action names and rediscover them through failed
            // provisioning, matching the harness provisioner. Resource ARNs are
            // minted at runtime, so this is scoped to the deploy-time CR role.
            evalProvisionerFn.addToRolePolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["bedrock-agentcore:*"],
                    resources: ["*"],
                })
            );
            // CreateEvaluator validates that the CALLER can invoke the judge
            // model, so the provisioner (not just the eval execution role) needs
            // bedrock:InvokeModel on the judge — the cross-region inference
            // profile plus its underlying foundation models.
            evalProvisionerFn.addToRolePolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["bedrock:InvokeModel", "bedrock:GetInferenceProfile"],
                    resources: ["*"],
                })
            );
            evalProvisionerFn.addToRolePolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["iam:PassRole"],
                    resources: [evalExecutionRole.roleArn],
                    conditions: {
                        StringEquals: { "iam:PassedToService": "bedrock-agentcore.amazonaws.com" },
                    },
                })
            );

            const evalProvider = new Provider(this, "EvalProvider", {
                onEventHandler: evalProvisionerFn,
            });

            const evalResource = new CustomResource(this, "EvalResource", {
                serviceToken: evalProvider.serviceToken,
                properties: {
                    ServiceNames: assistantServiceName,
                    JudgeModel: "us.amazon.nova-pro-v1:0",
                    // Bump to force the custom resource to re-run.
                    Rev: "2",
                },
            });
            evalResource.node.addDependency(evalExecutionRole);

            new CfnOutput(this, "EvalEvaluatorId_Output", {
                value: evalResource.getAttString("EvaluatorId"),
                description:
                    "AgentCore custom evaluator id for the AI Assistant; empty if the preview API was unavailable",
            });
            new CfnOutput(this, "EvalOnlineConfigId_Output", {
                value: evalResource.getAttString("OnlineEvalId"),
                description: "AgentCore online evaluation config id; empty if unavailable",
            });

            NagSuppressions.addResourceSuppressions(
                evalProvisionerFn,
                [
                    {
                        id: "AwsSolutions-IAM5",
                        reason: "Eval provisioner needs the bedrock-agentcore evaluator/online-eval actions on * (resource ARNs are created at runtime) and PassRole on the eval execution role.",
                    },
                ],
                true
            );
            NagSuppressions.addResourceSuppressions(
                evalProvider,
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

        // ─── AgentCore Runtimes ────────────────────────────────────────
        const jwtDiscoveryUrl = `${cognitoIssuer}/.well-known/openid-configuration`;

        // Both runtimes are defined with the stable L1 constructs from
        // aws-cdk-lib/aws-bedrockagentcore. The alpha L2 (`agentcore.Runtime`)
        // was dropped so the whole stack sits on the stable CDK channel — the
        // alpha package still ships breaking changes on minor bumps.
        const runtimeAuthorizerConfiguration: CfnRuntime.AuthorizerConfigurationProperty = {
            customJwtAuthorizer: {
                discoveryUrl: jwtDiscoveryUrl,
                allowedClients: [userPoolClient.userPoolClientId],
            },
        };

        const runtimeEnv: Record<string, string> = {
            AWS_REGION: this.region,
            AWS_DEFAULT_REGION: this.region,
            MEMORY_ID: memoryId,
            STACK_NAME: stackName,
            // The AI Assistant runtime re-signs catalog product images and (when
            // managed evaluation is on) writes evaluation datasets here.
            IMAGES_BUCKET: shared.imagesBucket.bucketName,
        };

        const runtimeArns: Record<string, string> = {};

        // ─── Fraud-Research Runtime (A2A, feature-gated) ───────────────
        // The headline A2A callee: a dedicated runtime configured with the A2A
        // server protocol (port 9000, agent-card discovery). Created BEFORE the
        // orchestrator loop so the account-opening (`ai_agent`) runtime can wire
        // its ARN into `FRAUD_AGENT_RUNTIME_ARN`. Its inbound authorizer accepts
        // ONLY the fraud agent's own client (`allowedClients`), and the caller
        // presents a token minted from that same client. The fraud agent reuses
        // the shared AgentCore execution role: that role already carries the
        // Bedrock model / ApplyGuardrail / SSM / Secrets / Memory permissions
        // the assessment needs, mirroring how the avatar runtime reuses it. The
        // one extra grant — least-privilege `InvokeAgentRuntime` scoped to this
        // runtime — is attached below for the caller's A2A hop.
        let fraudRuntimeArn: string | undefined;
        if (features.a2a && auth.fraudMachineClient) {
            const fraudImage = new DockerImageAsset(this, "FraudResearchImage", {
                directory: repoRoot,
                file: "patterns/fraud-research-agent/Dockerfile",
                platform: Platform.LINUX_ARM64,
            });

            const fraudRuntime = new CfnRuntime(this, "Runtime_fraud_research", {
                agentRuntimeName: `${stackName.replace(/-/g, "_")}_fraud_research`,
                agentRuntimeArtifact: {
                    containerConfiguration: {
                        containerUri: fraudImage.imageUri,
                    },
                },
                roleArn: agentCoreRole.roleArn,
                networkConfiguration: {
                    networkMode: "PUBLIC",
                },
                // A2A server protocol — this is what makes the runtime speak
                // agent-to-agent (card discovery + JSON-RPC message/send) on 9000.
                protocolConfiguration: "A2A",
                environmentVariables: {
                    ...runtimeEnv,
                    MODEL_ID: models.orchestrator,
                    AGENT_PROFILE: "fraud_research",
                    // Gateway URL is also published to SSM (read by the agent at
                    // call time); passed here for parity with the other runtimes.
                    GATEWAY_URL: gateway.attrGatewayUrl,
                    // The fraud agent mints its Gateway token from its OWN client
                    // (distinct principal, Req 7.4) via these param names.
                    FRAUD_AGENT_CLIENT_ID_PARAM: `/${stackName}/fraud_agent_client_id`,
                    FRAUD_AGENT_CLIENT_SECRET_PARAM: `/${stackName}/fraud_agent_client_secret`,
                    // Cognito issuer + audience so the callee can verify the
                    // forwarded customer user-pool JWT (Req 5.4).
                    COGNITO_USER_POOL_ISSUER: cognitoIssuer,
                    COGNITO_USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                },
                authorizerConfiguration: {
                    customJwtAuthorizer: {
                        discoveryUrl: jwtDiscoveryUrl,
                        allowedClients: [auth.fraudMachineClient.userPoolClientId],
                    },
                },
                // Forward the machine bearer to the container so the platform
                // authorizer validates it (Req 6.2). The customer identity rides
                // in the JSON-RPC body's metadata, not a header.
                requestHeaderConfiguration: {
                    requestHeaderAllowlist: ["Authorization"],
                },
                description: `Fraud & Research (A2A) agent for ${stackName}`,
            });

            fraudRuntime.node.addDependency(agentCoreRole);

            fraudRuntimeArn = fraudRuntime.attrAgentRuntimeArn;
            runtimeArns["fraud_research"] = fraudRuntimeArn;

            // Publish the fraud client id so both the fraud agent (Gateway
            // principal) and the account-opening caller (inbound bearer) resolve
            // it at runtime. The secret lives in Secrets Manager (Auth stack).
            new StringParameter(this, "FraudAgentClientIdParam", {
                parameterName: `/${stackName}/fraud_agent_client_id`,
                stringValue: auth.fraudMachineClient.userPoolClientId,
            });

            new StringParameter(this, "RuntimeArn_fraud_research", {
                parameterName: `/${stackName}/runtime_arn_fraud_research`,
                stringValue: fraudRuntimeArn,
            });

            new CfnOutput(this, "RuntimeArn_fraud_research_Output", {
                value: fraudRuntimeArn,
                description: "Runtime ARN for the Fraud & Research (A2A) agent",
            });

            // Least-privilege A2A invoke: grant the (shared) execution role the
            // data-plane InvokeAgentRuntime action scoped to ONLY the fraud
            // runtime, so the account-opening agent's A2A hop is tightly bounded
            // (Req 6.5). The `/*` covers the runtime's endpoints/sessions.
            //
            // The resource is a CONSTRUCTED ARN (region/account + runtime-name
            // prefix), NOT `fraudRuntime.attrAgentRuntimeArn`. Referencing the
            // runtime resource here made the shared role's DefaultPolicy depend
            // on the fraud runtime, while the fraud runtime already depends on
            // the role (roleArn + node dependency, which pulls in the role's
            // DefaultPolicy child) — a CloudFormation circular dependency. The
            // name-prefixed wildcard keeps the grant scoped to just this runtime.
            const fraudRuntimeName = `${stackName.replace(/-/g, "_")}_fraud_research`;
            const fraudRuntimeArnPattern = `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/${fraudRuntimeName}*`;
            agentCoreRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["bedrock-agentcore:InvokeAgentRuntime"],
                    resources: [fraudRuntimeArnPattern, `${fraudRuntimeArnPattern}/*`],
                })
            );
        }

        // ─── Section-Researcher Runtime (A2A, feature-gated) ───────────
        // The callee for the parallel research fan-out. When
        // features.a2a_parallel_research is on, the orchestrator's researcher
        // phase replaces its in-process worker sub-agents with A2A invocations
        // to this runtime (one per shard), forwarding the same customer
        // identity. Mirrors the fraud runtime (task 10): its own A2A image,
        // `protocolConfiguration: "A2A"`, a custom-JWT authorizer, and the
        // Authorization header forwarded so the platform validates the caller's
        // machine bearer. Gated independently and default-off given the higher
        // reliability risk; the proven in-process fan-out stays the fallback.
        //
        // Least privilege: the caller reuses the SHARED machine client (the same
        // principal the orchestrator already uses for the Gateway), so no new
        // Cognito client is minted — the runtime's inbound `allowedClients`
        // accepts that client and the section agent reaches the Gateway as it.
        let sectionResearcherRuntimeArn: string | undefined;
        if (features.a2a_parallel_research) {
            const sectionImage = new DockerImageAsset(this, "SectionResearcherImage", {
                directory: repoRoot,
                file: "patterns/section-researcher-agent/Dockerfile",
                platform: Platform.LINUX_ARM64,
            });

            const sectionRuntime = new CfnRuntime(this, "Runtime_section_researcher", {
                agentRuntimeName: `${stackName.replace(/-/g, "_")}_section_researcher`,
                agentRuntimeArtifact: {
                    containerConfiguration: {
                        containerUri: sectionImage.imageUri,
                    },
                },
                roleArn: agentCoreRole.roleArn,
                networkConfiguration: {
                    networkMode: "PUBLIC",
                },
                // A2A server protocol — card discovery + JSON-RPC message/send on 9000.
                protocolConfiguration: "A2A",
                environmentVariables: {
                    ...runtimeEnv,
                    MODEL_ID: models.orchestrator,
                    AGENT_PROFILE: "section_researcher",
                    GATEWAY_URL: gateway.attrGatewayUrl,
                    // The section agent reaches the Gateway with the shared
                    // machine client (default in section_gateway_access_token).
                    COGNITO_USER_POOL_ISSUER: cognitoIssuer,
                    COGNITO_USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                    // AgentCore Identity token path (features.agentcore_identity).
                    ...identityEnvFor(`${stackName.replace(/-/g, "_")}_section_researcher`),
                },
                authorizerConfiguration: {
                    customJwtAuthorizer: {
                        discoveryUrl: jwtDiscoveryUrl,
                        // The shared machine client is the caller principal.
                        allowedClients: [auth.machineClient.userPoolClientId],
                    },
                },
                requestHeaderConfiguration: {
                    requestHeaderAllowlist: ["Authorization"],
                },
                description: `Section Researcher (A2A) agent for ${stackName}`,
            });

            sectionRuntime.node.addDependency(agentCoreRole);

            sectionResearcherRuntimeArn = sectionRuntime.attrAgentRuntimeArn;
            runtimeArns["section_researcher"] = sectionResearcherRuntimeArn;

            new StringParameter(this, "RuntimeArn_section_researcher", {
                parameterName: `/${stackName}/runtime_arn_section_researcher`,
                stringValue: sectionResearcherRuntimeArn,
            });

            new CfnOutput(this, "RuntimeArn_section_researcher_Output", {
                value: sectionResearcherRuntimeArn,
                description: "Runtime ARN for the Section Researcher (A2A) agent",
            });

            // Least-privilege A2A invoke: grant the (shared) execution role the
            // data-plane InvokeAgentRuntime action scoped to ONLY the section
            // runtime, so the orchestrator's fan-out A2A hop is tightly bounded
            // (Req 6.5). The `/*` covers the runtime's endpoints/sessions.
            //
            // Constructed ARN (not the runtime resource attribute) for the same
            // reason as the fraud runtime above: referencing the resource here
            // creates a CloudFormation circular dependency via the shared role's
            // DefaultPolicy.
            const sectionRuntimeName = `${stackName.replace(/-/g, "_")}_section_researcher`;
            const sectionRuntimeArnPattern = `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/${sectionRuntimeName}*`;
            agentCoreRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["bedrock-agentcore:InvokeAgentRuntime"],
                    resources: [sectionRuntimeArnPattern, `${sectionRuntimeArnPattern}/*`],
                })
            );
        }

        // ─── Orchestrator Runtimes (one per agent experience) ──────────
        // The orchestrator is a single codebase whose entrypoint routes by a
        // `mode` field. We deploy it as three dedicated AgentCore Runtimes so
        // each agent experience is a first-class, independently listed, scaled,
        // and observable runtime — matching the requirement that Deep Research,
        // the AI Assistant, and the AI Agent are separate agents that each call
        // the shared Gateway. They reuse ONE container image (CDK dedupes the
        // asset by content hash, so it is built and pushed once), differing only
        // by name and an AGENT_PROFILE tag that identifies the experience in
        // logs/observability and scopes the Policy engine's per-agent rules.
        const orchestratorImage = new DockerImageAsset(this, "OrchestratorImage", {
            directory: repoRoot,
            file: "patterns/orchestrator-agent/Dockerfile",
            platform: Platform.LINUX_ARM64,
        });

        const orchestratorProfiles = [
            {
                key: "research",
                profile: "deep_research",
                label: "Deep Research + Research Studio",
            },
            { key: "assistant", profile: "ai_assistant", label: "AI Assistant" },
            { key: "agent", profile: "ai_agent", label: "AI Agent + archive chat" },
        ] as const;

        for (const { key, profile, label } of orchestratorProfiles) {
            const runtime = new CfnRuntime(this, `Runtime_${key}`, {
                agentRuntimeName: `${stackName.replace(/-/g, "_")}_${profile}`,
                agentRuntimeArtifact: {
                    containerConfiguration: {
                        containerUri: orchestratorImage.imageUri,
                    },
                },
                roleArn: agentCoreRole.roleArn,
                networkConfiguration: {
                    networkMode: "PUBLIC",
                },
                protocolConfiguration: "HTTP",
                environmentVariables: {
                    ...runtimeEnv,
                    MODEL_ID: models.orchestrator,
                    // Gate the in-process browser_tools import so operators
                    // can disable the microVM spend without rebuilding the
                    // image. See patterns/orchestrator-agent/browser_tools.py.
                    ENABLE_BROWSER_TOOLS: features.browser ? "true" : "false",
                    // Identifies which agent experience this runtime serves.
                    // Surfaced in logs and used to scope the Policy engine.
                    AGENT_PROFILE: profile,
                    // A2A fraud hop is exposed only in the account-opening
                    // (`ai_agent`) chatbot path. Enable it there and hand it the
                    // fraud runtime ARN + the fraud client params it authenticates
                    // to the fraud runtime with (Req 4.1, 5.1, 6.1). The caller
                    // and callee share the fraud client, so the fraud runtime's
                    // inbound `allowedClients` accepts the caller's token.
                    ENABLE_A2A: features.a2a && profile === "ai_agent" ? "true" : "false",
                    ...(features.a2a && profile === "ai_agent" && fraudRuntimeArn
                        ? {
                              FRAUD_AGENT_RUNTIME_ARN: fraudRuntimeArn,
                              FRAUD_CALLER_CLIENT_ID_PARAM: `/${stackName}/fraud_agent_client_id`,
                              FRAUD_CALLER_CLIENT_SECRET_PARAM: `/${stackName}/fraud_agent_client_secret`,
                          }
                        : {}),
                    // Prompt Optimization showcase (Req 1.5, 11.2, 12.2). The
                    // presenter-driven `optimize_prompt`/`optimize_sample` modes
                    // target the customer-facing AI Agent; the assistant runtime
                    // also serves the menu/chatbot path the showcase reads. Enable
                    // the mode router on both profiles when the flag is on; other
                    // profiles keep it off so those modes fall through to the
                    // proven default handling. Mirrors `ENABLE_A2A` targeting.
                    ENABLE_PROMPT_OPTIMIZATION:
                        features.prompt_optimization &&
                        (profile === "ai_agent" || profile === "ai_assistant")
                            ? "true"
                            : "false",
                    // Custom SageMaker model for the customer-facing AI Agent
                    // (features.sagemaker_model). Enabled only on the `ai_agent`
                    // profile: when on, `_handle_chatbot` builds a Strands
                    // SageMakerAIModel against SAGEMAKER_ENDPOINT_NAME instead of
                    // Bedrock. Off (or any other profile) keeps the proven
                    // Bedrock path. The endpoint name + region ride along only
                    // when enabled so nothing changes when the flag is off.
                    SAGEMAKER_MODEL_ENABLED:
                        features.sagemaker_model && profile === "ai_agent" ? "true" : "false",
                    ...(features.sagemaker_model && profile === "ai_agent"
                        ? {
                              SAGEMAKER_ENDPOINT_NAME: sagemaker.endpointName,
                              ...(sagemaker.regionName
                                  ? { SAGEMAKER_REGION: sagemaker.regionName }
                                  : {}),
                              ...(sagemaker.inferenceComponentName
                                  ? {
                                        SAGEMAKER_INFERENCE_COMPONENT_NAME:
                                            sagemaker.inferenceComponentName,
                                    }
                                  : {}),
                              SAGEMAKER_MAX_TOKENS: String(sagemaker.maxTokens),
                          }
                        : {}),
                    // Managed Bedrock evaluation of the catalog
                    // (features.bedrock_managed_eval). Only the AI Assistant
                    // (`ai_assistant`) profile runs the catalog flow, so the
                    // `catalog_evaluate` mode is enabled there. When on, the
                    // orchestrator passes THIS execution role as the evaluation
                    // job's role (it already trusts bedrock.amazonaws.com, reads
                    // /writes the images bucket, and invokes the judge model), so
                    // its ARN rides along. Off elsewhere / when the flag is off.
                    BEDROCK_MANAGED_EVAL_ENABLED:
                        features.bedrock_managed_eval && profile === "ai_assistant"
                            ? "true"
                            : "false",
                    ...(features.bedrock_managed_eval && profile === "ai_assistant"
                        ? { AGENTCORE_ROLE_ARN: agentCoreRole.roleArn }
                        : {}),
                    // AgentCore batch evaluation (features.agentcore_evaluation).
                    // Only the AI Assistant runs the catalog flow, so it auto-fires
                    // the pollable batch eval there.
                    AGENTCORE_EVAL_ENABLED:
                        features.agentcore_evaluation && profile === "ai_assistant"
                            ? "true"
                            : "false",
                    // AgentCore A/B config-bundle routing (features.agentcore_evaluation).
                    // The system-prompt A/B targets the AI Agent (chatbot), so the
                    // config-bundle hook is enabled there; it is a no-op unless a
                    // running A/B test injects a bundle for the session.
                    ENABLE_CONFIG_BUNDLE:
                        features.agentcore_evaluation && profile === "ai_agent" ? "true" : "false",
                    // The parallel section-researcher fan-out (Req 10) is
                    // exercised only by the research pipelines (Deep Research +
                    // Research Studio), which run under the "research" profile.
                    // Enable the A2A branch there and hand it the section
                    // runtime ARN; other profiles keep it off. When off (or the
                    // runtime is absent), the orchestrator uses the proven
                    // in-process fan-out as the fallback (Req 10.1, 12.2).
                    ENABLE_A2A_PARALLEL_RESEARCH:
                        features.a2a_parallel_research && profile === "deep_research"
                            ? "true"
                            : "false",
                    // AgentCore Identity token path (features.agentcore_identity).
                    ...identityEnvFor(`${stackName.replace(/-/g, "_")}_${profile}`),
                    ...(features.a2a_parallel_research &&
                    profile === "deep_research" &&
                    sectionResearcherRuntimeArn
                        ? { SECTION_RESEARCHER_RUNTIME_ARN: sectionResearcherRuntimeArn }
                        : {}),
                },
                authorizerConfiguration: runtimeAuthorizerConfiguration,
                // L1 spells this `requestHeaderAllowlist`; the alpha L2 called
                // it `allowlistedHeaders`. The Authorization header must be
                // forwarded so the runtime can read the caller's JWT `sub`
                // (see patterns/utils/auth.py::extract_user_id_from_context).
                requestHeaderConfiguration: {
                    requestHeaderAllowlist: ["Authorization"],
                },
                description: `${label} agent for ${stackName}`,
            });

            runtime.node.addDependency(agentCoreRole);

            runtimeArns[key] = runtime.attrAgentRuntimeArn;

            new StringParameter(this, `RuntimeArn_${key}`, {
                parameterName: `/${stackName}/runtime_arn_${key}`,
                stringValue: runtime.attrAgentRuntimeArn,
            });

            new CfnOutput(this, `RuntimeArn_${key}_Output`, {
                value: runtime.attrAgentRuntimeArn,
                description: `Runtime ARN for the ${label} agent`,
            });
        }

        this.researchRuntimeArn = runtimeArns["research"];
        this.assistantRuntimeArn = runtimeArns["assistant"];
        this.agentRuntimeArn = runtimeArns["agent"];
        // Back-compat alias — anything still reading the single orchestrator ARN
        // resolves to the Deep Research runtime.
        this.orchestratorRuntimeArn = runtimeArns["research"];

        // NOTE: the previous single-orchestrator runtime (`_orchestrator_v2`)
        // and its transitional cross-stack export were removed here once the
        // frontend migrated to the three per-agent exports above. The old
        // export is no longer imported by any stack, so CloudFormation can drop
        // it cleanly on this deploy.

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
                    // AgentCore Identity token path (features.agentcore_identity).
                    ...identityEnvFor(avatarRuntimeName),
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

        // The orchestrator (AI Assistant `menu_optimize` mode) reads recent
        // catalog feedback from this table to propose designer-prompt refinements
        // — the continuous feedback loop. Read-only; writes stay with the API.
        feedbackTable.grantReadData(agentCoreRole);

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
                                    // nosemgrep: detect-child-process
                                    // CDK asset bundling: `outputDir` is a CDK-generated temp path,
                                    // `feedbackLambdaDir` is a compile-time constant.
                                    cp.execSync(
                                        `python3 -m pip install -r ${path.join(feedbackLambdaDir, "requirements.txt")} -t "${outputDir}" --quiet --no-cache-dir`,
                                        { stdio: "pipe" }
                                    );
                                    // nosemgrep: detect-child-process
                                    // Same rationale as above — CDK-controlled paths only.
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
            // The summary endpoint queries the feedbackType-timestamp GSI to
            // build the continuous-feedback-loop dashboard.
            feedbackTable.grantReadData(feedbackLambda);

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
            const feedbackIntegration = new apigateway.LambdaIntegration(feedbackLambda);
            feedbackResource.addMethod("POST", feedbackIntegration, {
                authorizer,
                authorizationType: apigateway.AuthorizationType.COGNITO,
            });
            // GET /feedback/summary — aggregated continuous-loop dashboard data.
            feedbackResource.addResource("summary").addMethod("GET", feedbackIntegration, {
                authorizer,
                authorizationType: apigateway.AuthorizationType.COGNITO,
            });

            // ─── Catalog eval status endpoint (Bedrock model-eval A/B) ──
            // GET /catalog-eval?jobs=<arn1>,<arn2> — lets the ServicesCatalog
            // card poll the async Bedrock model-evaluation jobs it launched and
            // render live status + the copy-quality score once each completes.
            // Gated on the same flag as the launch button.
            if (features.bedrock_managed_eval) {
                const evalStatusDir = path.join(
                    __dirname,
                    "..",
                    "..",
                    "lambdas",
                    "catalog-eval-status"
                );
                const evalStatusLogGroup = new LogGroup(this, "CatalogEvalStatusLogGroup", {
                    logGroupName: `/aws/lambda/${stackName}-catalog-eval-status`,
                    retention: RetentionDays.ONE_WEEK,
                    removalPolicy: RemovalPolicy.DESTROY,
                });
                const evalStatusLambda = new LambdaFunction(this, "CatalogEvalStatusLambda", {
                    functionName: `${stackName}-catalog-eval-status`,
                    runtime: LambdaRuntime.PYTHON_3_13,
                    handler: "index.handler",
                    architecture: Architecture.ARM_64,
                    logGroup: evalStatusLogGroup,
                    timeout: Duration.seconds(30),
                    memorySize: 256,
                    code: Code.fromAsset(evalStatusDir, {
                        bundling: {
                            image: LambdaRuntime.PYTHON_3_13.bundlingImage,
                            command: [
                                "bash",
                                "-c",
                                "pip install -r requirements.txt -t /asset-output && cp -r . /asset-output",
                            ],
                        },
                    }),
                    environment: { CORS_ALLOWED_ORIGINS: corsOrigins.join(",") },
                });
                // Read Bedrock model-eval job status + results from the images
                // bucket, and AgentCore batch-eval status + its results log stream.
                evalStatusLambda.addToRolePolicy(
                    new PolicyStatement({
                        effect: Effect.ALLOW,
                        actions: [
                            "bedrock:GetEvaluationJob",
                            "bedrock-agentcore:GetBatchEvaluation",
                        ],
                        resources: ["*"],
                    })
                );
                evalStatusLambda.addToRolePolicy(
                    new PolicyStatement({
                        effect: Effect.ALLOW,
                        actions: ["logs:GetLogEvents"],
                        resources: [
                            `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/evaluations/batch-evaluations/results*`,
                        ],
                    })
                );
                shared.imagesBucket.grantRead(evalStatusLambda);

                const evalStatusIntegration = new apigateway.LambdaIntegration(evalStatusLambda);
                api.root.addResource("catalog-eval").addMethod("GET", evalStatusIntegration, {
                    authorizer,
                    authorizationType: apigateway.AuthorizationType.COGNITO,
                });
                NagSuppressions.addResourceSuppressions(
                    evalStatusLambda,
                    [
                        {
                            id: "AwsSolutions-IAM5",
                            reason: "bedrock:GetEvaluationJob is not resource-scopeable; S3 read is scoped to the images bucket via grantRead.",
                        },
                    ],
                    true
                );
            }

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
                                            // nosemgrep: detect-child-process
                                            // CDK asset bundling: `outputDir` is a CDK-generated temp
                                            // path, `kbResetLambdaDir` is a compile-time constant.
                                            cp.execSync(
                                                `python3 -m pip install -r ${path.join(kbResetLambdaDir, "requirements.txt")} -t "${outputDir}" --quiet --no-cache-dir`,
                                                { stdio: "pipe" }
                                            );
                                            // nosemgrep: detect-child-process
                                            // Same rationale as above — CDK-controlled paths only.
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

            // ─── Run history API ───────────────────────────────────────
            // Report links used to break after an hour: pdf_generator returns a
            // presigned URL, the frontend kept it in client state, and nothing
            // minted a new one, so reopening any earlier run gave S3
            // AccessDenied. This endpoint signs a fresh URL per request from the
            // stored S3 key, which both fixes the expiry and makes a browsable
            // history possible. No extra dependencies, so no bundling step.
            const reportsHistoryDir = path.join(
                __dirname,
                "..",
                "..",
                "lambdas",
                "reports-history"
            );
            if (fs.existsSync(reportsHistoryDir)) {
                const reportsHistoryLogGroup = new LogGroup(this, "ReportsHistoryLogGroup", {
                    logGroupName: `/aws/lambda/${stackName}-reports-history`,
                    retention: RetentionDays.ONE_WEEK,
                    removalPolicy: RemovalPolicy.DESTROY,
                });

                const reportsHistoryLambda = new LambdaFunction(this, "ReportsHistoryLambda", {
                    functionName: `${stackName}-reports-history`,
                    runtime: LambdaRuntime.PYTHON_3_13,
                    handler: "handler.handler",
                    architecture: Architecture.ARM_64,
                    logGroup: reportsHistoryLogGroup,
                    code: Code.fromAsset(reportsHistoryDir),
                    environment: {
                        METADATA_TABLE: shared.metadataTable.tableName,
                        REPORTS_BUCKET: shared.reportsBucket.bucketName,
                    },
                    timeout: Duration.seconds(30),
                });

                shared.metadataTable.grantReadData(reportsHistoryLambda);
                // Read is enough: the function only signs GETs, never writes.
                shared.reportsBucket.grantRead(reportsHistoryLambda);

                const reportsResource = api.root.addResource("reports");
                const reportsIntegration = new apigateway.LambdaIntegration(reportsHistoryLambda);
                reportsResource.addMethod("GET", reportsIntegration, {
                    authorizer,
                    authorizationType: apigateway.AuthorizationType.COGNITO,
                });
                reportsResource.addResource("{reportId}").addMethod("GET", reportsIntegration, {
                    authorizer,
                    authorizationType: apigateway.AuthorizationType.COGNITO,
                });

                // GET /website-latest — the newest generated services website,
                // freshly signed, for the Avatar/Digital Human showcase. Same
                // lambda (reuses the metadata table + reports bucket + signing).
                api.root.addResource("website-latest").addMethod("GET", reportsIntegration, {
                    authorizer,
                    authorizationType: apigateway.AuthorizationType.COGNITO,
                });
            }

            // ─── Research status (grounding readiness) ──────────────────
            // Knowledge Base ingestion is asynchronous, so the AI Assistant can
            // legitimately find nothing to ground on right after a report is
            // written. This endpoint lets the UI say "indexing…" instead of
            // silently producing an ungrounded catalog.
            const researchStatusDir = path.join(
                __dirname,
                "..",
                "..",
                "lambdas",
                "research-status"
            );
            if (fs.existsSync(researchStatusDir)) {
                const researchStatusLogGroup = new LogGroup(this, "ResearchStatusLogGroup", {
                    logGroupName: `/aws/lambda/${stackName}-research-status`,
                    retention: RetentionDays.ONE_WEEK,
                    removalPolicy: RemovalPolicy.DESTROY,
                });

                const researchStatusLambda = new LambdaFunction(this, "ResearchStatusLambda", {
                    functionName: `${stackName}-research-status`,
                    runtime: LambdaRuntime.PYTHON_3_13,
                    handler: "handler.handler",
                    architecture: Architecture.ARM_64,
                    logGroup: researchStatusLogGroup,
                    // Standard library + boto3 only: no bundling step needed.
                    code: Code.fromAsset(researchStatusDir),
                    environment: {
                        METADATA_TABLE: shared.metadataTable.tableName,
                        ...(kbId ? { KNOWLEDGE_BASE_ID: kbId } : {}),
                        ...(kbDataSourceId ? { DATA_SOURCE_ID: kbDataSourceId } : {}),
                        GROUNDING_PIPELINE: "strategy_research",
                    },
                    timeout: Duration.seconds(15),
                });

                shared.metadataTable.grantReadData(researchStatusLambda);
                researchStatusLambda.addToRolePolicy(
                    new PolicyStatement({
                        effect: Effect.ALLOW,
                        actions: ["bedrock:ListIngestionJobs"],
                        resources: ["*"],
                    })
                );
                NagSuppressions.addResourceSuppressions(
                    researchStatusLambda,
                    [
                        {
                            id: "AwsSolutions-IAM5",
                            reason:
                                "ListIngestionJobs is a read-only status call; the knowledge base " +
                                "id is resolved from SSM at synth time and cannot be scoped further here.",
                        },
                        {
                            id: "AwsSolutions-IAM4",
                            reason: "Lambda basic execution role is required for logging.",
                        },
                    ],
                    true
                );

                api.root
                    .addResource("research-status")
                    .addMethod("GET", new apigateway.LambdaIntegration(researchStatusLambda), {
                        authorizer,
                        authorizationType: apigateway.AuthorizationType.COGNITO,
                    });
            }

            // ─── Self-hosted x402 merchant (feature-gated) ─────────────
            // A paywalled premium-data endpoint that lives inside the stack, so
            // the Deep Research Agent can demonstrate AgentCore Payments without
            // calling an external API or moving real funds.
            //
            // SECURITY NOTE: these methods are intentionally UNAUTHENTICATED
            // (authorizationType NONE). In x402, the HTTP 402 payment challenge
            // *is* the access control — a Cognito authorizer would make the
            // paywall unreachable by the paying agent. The exposure is bounded:
            // the endpoint serves only synthetic demonstration datasets, it is
            // covered by the same regional WAF web ACL as the rest of this API,
            // and it holds no customer data.
            if (features.payments) {
                const x402Dir = path.join(__dirname, "..", "..", "lambdas", "x402-merchant");
                if (fs.existsSync(x402Dir)) {
                    const x402LogGroup = new LogGroup(this, "X402MerchantLogGroup", {
                        logGroupName: `/aws/lambda/${stackName}-x402-merchant`,
                        retention: RetentionDays.ONE_WEEK,
                        removalPolicy: RemovalPolicy.DESTROY,
                    });

                    const x402Lambda = new LambdaFunction(this, "X402MerchantLambda", {
                        functionName: `${stackName}-x402-merchant`,
                        runtime: LambdaRuntime.PYTHON_3_13,
                        handler: "index.handler",
                        architecture: Architecture.ARM_64,
                        logGroup: x402LogGroup,
                        // No bundling step: the handler uses only the standard
                        // library, so the raw directory is a valid asset.
                        code: Code.fromAsset(x402Dir),
                        environment: {
                            PRICE_ATOMIC_UNITS: "2500",
                            PRICE_DISPLAY_USD: "0.0025",
                            // Base Sepolia testnet — faucet funds, no real money.
                            PAY_NETWORK: "eip155:84532",
                            PAY_TO_ADDRESS: this.node.tryGetContext("x402PayTo") ?? "",
                            ASSET_ADDRESS: this.node.tryGetContext("x402Asset") ?? "",
                            ASSET_NAME: "USDC",
                        },
                        timeout: Duration.seconds(15),
                    });

                    const x402Resource = api.root.addResource("x402");
                    const x402Integration = new apigateway.LambdaIntegration(x402Lambda);
                    // Free catalog so the agent can discover what is for sale.
                    const x402CatalogMethod = x402Resource.addMethod("GET", x402Integration, {
                        authorizationType: apigateway.AuthorizationType.NONE,
                    });
                    // Paywalled datasets: /x402/data/{datasetId}
                    const x402DataMethod = x402Resource
                        .addResource("data")
                        .addResource("{datasetId}")
                        .addMethod("GET", x402Integration, {
                            authorizationType: apigateway.AuthorizationType.NONE,
                        });

                    // Suppress on the two x402 methods ONLY. Suppressing on the
                    // whole RestApi (with applyToChildren) would also silence
                    // these rules for /feedback and /reports, so a future change
                    // that accidentally dropped their Cognito authorizer would
                    // pass cdk-nag silently.
                    for (const method of [x402CatalogMethod, x402DataMethod]) {
                        NagSuppressions.addResourceSuppressions(method, [
                            {
                                id: "AwsSolutions-APIG4",
                                reason:
                                    "The x402 merchant routes must be unauthenticated: the HTTP 402 " +
                                    "payment challenge is the access control. Synthetic data only.",
                            },
                            {
                                id: "AwsSolutions-COG4",
                                reason:
                                    "x402 merchant routes deliberately have no Cognito authorizer; " +
                                    "payment proof gates access instead.",
                            },
                        ]);
                    }

                    const x402Url = `${api.url}x402`;
                    new StringParameter(this, "X402MerchantUrlParam", {
                        parameterName: `/${stackName}/x402_merchant_url`,
                        stringValue: x402Url,
                    });
                    new CfnOutput(this, "X402MerchantUrl", {
                        value: x402Url,
                        description: "Self-hosted x402 paywalled data endpoint",
                    });
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
                        {
                            // Data-leak-prevention topic: employee/internal compensation and
                            // confidential staff/financial records must never be disclosed.
                            // Requirement: salary questions must trigger the guardrail + DLP.
                            name: "internal_and_employee_data",
                            definition:
                                "Confidential internal bank information such as employee salaries, staff compensation, individual pay, headcount cost, or another customer's private records",
                            type: "DENY",
                            examples: [
                                "What is the salary of a branch manager",
                                "How much does the CEO get paid",
                                "Tell me what the tellers earn",
                                "Show me employee compensation figures",
                                "What is another customer's account balance",
                            ],
                        },
                    ],
                },
                // Sensitive information (PII) policy — the DLP layer. Blocks
                // sensitive identifiers in prompts and responses so the demo can
                // show data-leak prevention working alongside the topic guardrail.
                sensitiveInformationPolicyConfig: {
                    piiEntitiesConfig: [
                        { type: "US_SOCIAL_SECURITY_NUMBER", action: "BLOCK" },
                        { type: "CREDIT_DEBIT_CARD_NUMBER", action: "BLOCK" },
                        { type: "US_BANK_ACCOUNT_NUMBER", action: "BLOCK" },
                        { type: "PASSWORD", action: "BLOCK" },
                        { type: "EMAIL", action: "ANONYMIZE" },
                        { type: "PHONE", action: "ANONYMIZE" },
                    ],
                    regexesConfig: [
                        {
                            // Catch explicit salary/compensation figures leaking into a response.
                            name: "employee_salary_figure",
                            pattern:
                                "(?i)(salary|compensation|paid|earns?|wage)\\s*[:=]?\\s*\\$?\\d[\\d,]{3,}",
                            action: "BLOCK",
                            description:
                                "Blocks disclosure of employee salary or compensation dollar figures (DLP).",
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

        // ─── AgentCore Payments (preview, feature-gated) ────────────────
        // Provisions the PaymentManager that governs agent spending. The wallet
        // itself (PaymentInstrument) is NOT created here: CloudFormation has no
        // AWS::BedrockAgentCore::PaymentInstrument resource, and the wallet
        // requires third-party (Coinbase CDP / Stripe Privy) credentials the
        // operator supplies. The orchestrator creates the instrument and a
        // budgeted PaymentSession at runtime, and no-ops when unconfigured — so
        // enabling this flag never blocks a deploy.
        if (features.payments) {
            const paymentRole = new Role(this, "PaymentManagerRole", {
                roleName: `${stackName}-payment-manager-role`,
                assumedBy: new ServicePrincipal("bedrock-agentcore.amazonaws.com"),
                description: "Role assumed by the AgentCore payment manager",
            });
            // The payment manager reads the wallet credentials that AgentCore
            // Identity holds; it never receives the raw keys.
            paymentRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        "bedrock-agentcore:GetPaymentCredentialProvider",
                        "bedrock-agentcore:GetWorkloadAccessToken",
                        "secretsmanager:GetSecretValue",
                    ],
                    resources: ["*"],
                })
            );
            NagSuppressions.addResourceSuppressions(
                paymentRole,
                [
                    {
                        id: "AwsSolutions-IAM5",
                        reason:
                            "Payment manager and credential-provider ARNs are generated at runtime, " +
                            "so they cannot be enumerated at synth time.",
                    },
                ],
                true
            );

            // No L1 construct ships in aws-cdk-lib 2.253.1 for this preview
            // resource, so it is declared directly. Property names and the
            // AuthorizerType enum are per the CloudFormation reference.
            const paymentManager = new CfnResource(this, "PaymentManager", {
                type: "AWS::BedrockAgentCore::PaymentManager",
                properties: {
                    // Pattern allows letters/digits/underscore only — no hyphens,
                    // so the stack name's separators are stripped.
                    Name: `${stackName.replace(/[^a-zA-Z0-9]/g, "")}PaymentManager`.slice(0, 48),
                    // AWS_IAM: the orchestrator runtime already authenticates to
                    // AWS with its execution role, so no separate JWT is needed.
                    AuthorizerType: "AWS_IAM",
                    RoleArn: paymentRole.roleArn,
                    // Description pattern permits alphanumerics and spaces only.
                    Description: "Spending governance for the Deep Research Agent",
                },
            });
            paymentManager.node.addDependency(paymentRole);

            const paymentManagerArn = paymentManager.getAtt("PaymentManagerArn").toString();

            // Let the orchestrator create instruments/sessions and process
            // payments. Budget enforcement happens inside the service, so these
            // permissions cannot be used to exceed an approved session limit.
            agentCoreRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        "bedrock-agentcore:CreatePaymentInstrument",
                        "bedrock-agentcore:GetPaymentInstrument",
                        "bedrock-agentcore:GetPaymentInstrumentBalance",
                        "bedrock-agentcore:ListPaymentInstruments",
                        "bedrock-agentcore:CreatePaymentSession",
                        "bedrock-agentcore:GetPaymentSession",
                        "bedrock-agentcore:ListPaymentSessions",
                        "bedrock-agentcore:ProcessPayment",
                    ],
                    resources: ["*"],
                })
            );

            new StringParameter(this, "PaymentManagerArnParam", {
                parameterName: `/${stackName}/payment_manager_arn`,
                stringValue: paymentManagerArn,
            });

            new CfnOutput(this, "PaymentManagerArn", {
                value: paymentManagerArn,
                description: "AgentCore Payments manager ARN (preview)",
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
