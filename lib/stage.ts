import { Aspects, Stage, StageProps } from "aws-cdk-lib";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { getFeatureFlags, getStackNameBase } from "./common/feature-flags";
import { AgentRegistry, AgentRegistryAgent } from "./stacks/agent-registry";
import { Auth } from "./stacks/auth";
import { Backend } from "./stacks/backend";
import { Frontend, FrontendDeployment } from "./stacks/frontend";
import { LiveKit } from "./stacks/livekit";
import { Shared } from "./stacks/shared";
import { TavusAvatar } from "./stacks/tavus-avatar";

export class ApplicationStage extends Stage {
    constructor(scope: Construct, id: string, props?: StageProps) {
        super(scope, id, props);

        const features = getFeatureFlags(this.node);

        const frontend = new Frontend(this, "Frontend");

        const auth = new Auth(this, "Auth", {
            urls: frontend.urls,
        });

        const shared = new Shared(this, "Shared");

        const backend = new Backend(this, "Backend", {
            auth,
            shared,
        });
        backend.addDependency(shared);
        backend.addDependency(auth);

        // LiveKit voice path (Option 1 — LiveKit Cloud + Fargate worker).
        // Gated on the `livekit` flag; depends on backend for the gateway_url
        // SSM param the worker reads at runtime.
        let livekit: LiveKit | undefined;
        if (features.livekit) {
            livekit = new LiveKit(this, "LiveKit", { auth });
            livekit.addDependency(auth);
            livekit.addDependency(backend);
        }

        // Tavus video-avatar path (Strategy A — parallel Pipecat + Nova Sonic
        // worker). Gated on the `tavus_avatar` flag; depends on backend for the
        // gateway_url SSM param the worker reads at runtime.
        let tavusAvatar: TavusAvatar | undefined;
        if (features.tavus_avatar) {
            tavusAvatar = new TavusAvatar(this, "TavusAvatar", { auth });
            tavusAvatar.addDependency(auth);
            tavusAvatar.addDependency(backend);
        }

        // AWS Agent Registry (preview) publishing. Gated on `agent_registry`;
        // when off, nothing is created. Registers the demo's A2A agents as
        // APPROVED records so the console lists them. Identity/skill values are
        // kept in sync with the python agent-card modules under `patterns/`
        // (fraud-research-agent/agent_card.py, section-researcher-agent/
        // agent_card.py). The runtime invocation URLs are derived by the custom
        // resource from the runtime ARNs the Backend stack publishes to SSM, so
        // no cross-stack ARN reference is needed.
        if (features.agent_registry) {
            const stackNameBase = getStackNameBase(this.node);
            const registryAgents: AgentRegistryAgent[] = [];

            // Fraud & Research agent — deployed whenever the A2A fraud hop is on.
            if (features.a2a) {
                registryAgents.push({
                    recordName: "fraud-research-agent",
                    displayName: "Trinity Fraud & Research Agent",
                    name: "Trinity Fraud & Research Agent",
                    description:
                        "Fraud and research assessment for account-opening KYC over synthetic " +
                        "applicant data. Runs research tools only; performs no external calls and " +
                        "no account or PII writes.",
                    version: "1.0.0",
                    skills: [
                        {
                            id: "fraud_research_assessment",
                            name: "Fraud & Research Assessment",
                            description:
                                "Assess a synthetic account-opening applicant for fraud/research signals.",
                            tags: ["fraud", "kyc", "research"],
                        },
                    ],
                    runtimeArnParam: `/${stackNameBase}/runtime_arn_fraud_research`,
                });
            }

            // The reusable experience runtimes, published as CUSTOM records:
            // they are invocable over the AgentCore HTTP protocol (not A2A), so
            // an honest catalog documents their capability + invocation
            // contract instead of fabricating an A2A card. The Deep Research
            // record enumerates its in-process phases (planner, researchers,
            // synthesizer, evaluator) so a team searching for any of them
            // discovers the pipeline that contains them.
            registryAgents.push({
                recordType: "CUSTOM",
                recordName: "deep-research-pipeline",
                displayName: "Trinity Deep Research Pipeline",
                name: "Trinity Deep Research Pipeline",
                description:
                    "Multi-phase research pipeline over synthetic bank data: a planner " +
                    "drafts an approvable research plan, parallel researchers gather " +
                    "KB/web/analysis evidence, a synthesizer compiles the cited report " +
                    "and PDF, and an LLM judge scores the result. Reusable by any team " +
                    "that needs grounded research with citations.",
                version: "1.0.0",
                skills: [
                    {
                        id: "deep_research",
                        name: "Deep Research",
                        description:
                            "Plan, research, synthesize, and score a cited research report from a brief.",
                        tags: ["research", "planning", "synthesis", "evaluation", "reports"],
                    },
                ],
                phases: ["planner", "researcher (parallel)", "synthesizer & report", "evaluator"],
                payloadContract: { mode: "research", prompt: "<research brief>" },
                runtimeArnParam: `/${stackNameBase}/runtime_arn_research`,
            });
            registryAgents.push({
                recordType: "CUSTOM",
                recordName: "ai-assistant-catalog",
                displayName: "Trinity AI Assistant (Catalog Designer)",
                name: "Trinity AI Assistant",
                description:
                    "Designs a grounded client services catalog from the latest research " +
                    "report: drafts sections and copy, runs quality control and A/B " +
                    "evaluation, generates product imagery, and exports PDF + website.",
                version: "1.0.0",
                skills: [
                    {
                        id: "catalog_design",
                        name: "Services Catalog Design",
                        description: "Design, evaluate, and export a grounded services catalog.",
                        tags: ["catalog", "design", "imagery", "export"],
                    },
                ],
                // Matches the runtime catalog pipeline: the design invocation
                // runs the designer, then quality control, A/B model evaluation,
                // and the human-review handoff; the export invocation renders the
                // PDF and website. (Previously advertised a non-existent
                // "evaluator" and mis-named "website_writer".)
                phases: [
                    "menu_designer",
                    "menu_qc",
                    "menu_ab",
                    "menu_review",
                    "menu_pdf_writer",
                    "menu_website_writer",
                ],
                payloadContract: { mode: "menu", prompt: "<catalog brief>" },
                runtimeArnParam: `/${stackNameBase}/runtime_arn_assistant`,
            });
            registryAgents.push({
                recordType: "CUSTOM",
                recordName: "ai-client-advisor",
                displayName: "Trinity AI Client Advisor",
                name: "Trinity AI Client Advisor",
                description:
                    "Customer-facing banking advisor: guardrail-protected RAG chat over " +
                    "the product KB, KYC-gated account opening (consults the Fraud & " +
                    "Research agent over A2A), and per-customer memory.",
                version: "1.0.0",
                skills: [
                    {
                        id: "client_advisor_chat",
                        name: "Client Advisor Chat",
                        description:
                            "Grounded, guardrailed customer chat with KYC account opening.",
                        tags: ["rag", "kyc", "guardrails", "chat"],
                    },
                ],
                payloadContract: { mode: "chatbot", prompt: "<customer message>" },
                runtimeArnParam: `/${stackNameBase}/runtime_arn_agent`,
            });

            // Avatar / Digital Human — the voice experience runtime (WebSocket
            // bidirectional audio, Nova Sonic). Only deployed when the avatar
            // flag is on, so only register it then.
            if (features.avatar) {
                registryAgents.push({
                    recordType: "CUSTOM",
                    recordName: "avatar-digital-human",
                    displayName: "Trinity Avatar / Digital Human",
                    name: "Trinity Avatar / Digital Human",
                    description:
                        "Live-speech digital human advisor: bidirectional voice over " +
                        "WebSocket (Nova Sonic), multilingual with selectable voices and " +
                        "personas, grounded in the product KB with tool access, and a " +
                        "server-rendered video avatar option.",
                    version: "1.0.0",
                    skills: [
                        {
                            id: "voice_advisor",
                            name: "Voice Advisor",
                            description:
                                "Real-time spoken banking assistance with KB grounding and tools.",
                            tags: ["voice", "speech", "multilingual", "avatar"],
                        },
                    ],
                    payloadContract: {
                        protocol: "WebSocket (bidirectional audio)",
                        note: "Connect via SigV4-presigned AgentCore WebSocket; audio in/out.",
                    },
                    runtimeArnParam: `/${stackNameBase}/runtime_arn_avatar`,
                });
            }

            // Section Researcher — only deployed as a runtime when the parallel
            // research A2A path is on, so only register it then.
            if (features.a2a_parallel_research) {
                registryAgents.push({
                    recordName: "section-researcher-agent",
                    displayName: "Trinity Section Researcher",
                    name: "Trinity Section Researcher",
                    description:
                        "Parallel deep-research section worker over synthetic data. Researches one " +
                        "shard of a research plan's sub-questions using research tools only and " +
                        "returns the researcher JSON document consumed by the orchestrator's merge.",
                    version: "1.0.0",
                    skills: [
                        {
                            id: "section_research",
                            name: "Section Research",
                            description:
                                "Research one shard of a research plan's sub-questions over synthetic data.",
                            tags: ["research", "web", "kb"],
                        },
                    ],
                    runtimeArnParam: `/${stackNameBase}/runtime_arn_section_researcher`,
                });
            }

            const agentRegistry = new AgentRegistry(this, "AgentRegistry", {
                agents: registryAgents,
            });
            // Depends on backend for the runtime-ARN SSM parameters it reads.
            agentRegistry.addDependency(backend);
        }

        const environmentVariables: Record<string, string> = {
            // Existing env vars
            VITE_REGION: this.region!,
            VITE_STAGE: this.stageName || "",
            VITE_BUILD_VERSION: process.env.npm_package_version || "",
            VITE_CALLBACK_URL: frontend.urls[0],
            VITE_USER_POOL_ID: auth.userPool.userPoolId,
            ...(auth.userPoolDomain && {
                VITE_USER_POOL_DOMAIN_URL: auth.userPoolDomain.baseUrl().replace("https://", ""),
            }),
            VITE_USER_POOL_CLIENT_ID: auth.userPoolClient.userPoolClientId,
            VITE_IDENTITY_POOL_ID: auth.identityPoolId,
            // OIDC auth (react-oidc-context)
            VITE_COGNITO_USER_POOL_ID: auth.userPool.userPoolId,
            VITE_COGNITO_CLIENT_ID: auth.userPoolClient.userPoolClientId,
            VITE_COGNITO_REGION: this.region!,
            VITE_COGNITO_REDIRECT_URI: frontend.urls[0],
            VITE_COGNITO_POST_LOGOUT_REDIRECT_URI: frontend.urls[0],
            VITE_COGNITO_SCOPE: "email openid profile",
            // Federated IdP — when midway is enabled, the AmazonFederate OIDC provider is
            // registered on the user pool client (see FederateUserPoolClient). Surfacing the
            // provider name to the frontend lets us pass identity_provider=AmazonFederate on
            // signinRedirect so Cognito's Hosted UI skips the IdP chooser and jumps straight
            // to Midway.
            ...(this.node.getContext("accounts")?.[this.stageName ?? ""]?.midway
                ? { VITE_COGNITO_IDENTITY_PROVIDER: "AmazonFederate" }
                : {}),
            // Backend runtime ARNs (cross-stack references). One per agent
            // experience; the frontend picks the ARN by mode. ORCHESTRATOR is
            // kept as a back-compat alias pointing at the Deep Research runtime.
            VITE_RUNTIME_ARN_ORCHESTRATOR: backend.orchestratorRuntimeArn,
            VITE_RUNTIME_ARN_RESEARCH: backend.researchRuntimeArn,
            VITE_RUNTIME_ARN_ASSISTANT: backend.assistantRuntimeArn,
            VITE_RUNTIME_ARN_AGENT: backend.agentRuntimeArn,
            ...(features.avatar && backend.avatarRuntimeArn
                ? { VITE_RUNTIME_ARN_AVATAR: backend.avatarRuntimeArn }
                : {}),
            VITE_FEEDBACK_API_URL: backend.feedbackApiUrl,
            VITE_GATEWAY_URL: backend.gatewayUrl,
            // LiveKit token endpoint — the browser POSTs here (with its Cognito
            // JWT) to get a room token + LiveKit Cloud server URL.
            ...(features.livekit && livekit ? { VITE_LIVEKIT_TOKEN_URL: livekit.tokenApiUrl } : {}),
            // Tavus offer endpoint — the browser POSTs here (with its Cognito
            // JWT) to start a Tavus video-avatar session. Presence of this var
            // is what makes the "Realistic" (Tavus) picker entry appear.
            ...(features.tavus_avatar && tavusAvatar
                ? { VITE_TAVUS_OFFER_URL: tavusAvatar.offerApiUrl }
                : {}),
            // Gates the paid-data budget control on the research plan card. Only
            // "true" enables it, so a stack without payments never offers the
            // user a spend authorization it cannot honour.
            VITE_PAYMENTS_ENABLED: features.payments ? "true" : "false",
            // Gates the flow-panel "Fraud Research Agent" A2A node. Only "true"
            // (the A2A fraud hop is deployed) makes the node render, so a stack
            // built without the fraud runtime never shows a step that cannot fire.
            VITE_FRAUD_AGENT_ENABLED: features.a2a ? "true" : "false",
            // Gates the Prompt Optimization Showcase_Card entry point and the
            // flow-panel "Prompt Optimization" node. Only "true" (the showcase
            // is enabled) surfaces the affordances, so a stack built without it
            // never shows a step the backend will not accept.
            VITE_PROMPT_OPTIMIZATION_ENABLED: features.prompt_optimization ? "true" : "false",
        };

        // this stack must be named FrontendDeployment
        const frontendDeployment = new FrontendDeployment(this, "FrontendDeployment", {
            websiteBucket: frontend.websiteBucket,
            distribution: frontend.distribution,
            websiteAsset: frontend.websiteAsset,
            environmentVariables,
        });
        frontendDeployment.addDependency(backend);

        NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: "AwsSolutions-IAM4",
                    reason: "Lambda functions can require managed policies.",
                    appliesTo: [
                        "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
                        "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
                    ],
                },
                {
                    id: "AwsSolutions-IAM5",
                    reason: "High-level constructs can require wildcards for dynamic resource creation and management.",
                },
                {
                    id: "AwsSolutions-L1",
                    reason: "High-level constructs can set their own runtimes.",
                },
                {
                    id: "AwsSolutions-S1",
                    reason: "Server access logging not required for all demo S3 buckets.",
                },
                {
                    id: "AwsSolutions-DDB3",
                    reason: "PITR not required for demo DynamoDB tables.",
                },
            ],
            true
        );
        Aspects.of(this).add(new AwsSolutionsChecks());
    }
}
