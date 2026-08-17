import { Aspects, Stage, StageProps } from "aws-cdk-lib";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { getFeatureFlags } from "./common/feature-flags";
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
