import { Aspects, Stage, StageProps } from "aws-cdk-lib";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { getFeatureFlags } from "./common/feature-flags";
import { Auth } from "./stacks/auth";
import { Backend } from "./stacks/backend";
import { Frontend, FrontendDeployment } from "./stacks/frontend";
import { Shared } from "./stacks/shared";

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
            // Backend runtime ARNs
            VITE_RUNTIME_ARN_ORCHESTRATOR: backend.orchestratorRuntimeArn,
            ...(features.avatar && backend.avatarRuntimeArn
                ? { VITE_RUNTIME_ARN_AVATAR: backend.avatarRuntimeArn }
                : {}),
            VITE_FEEDBACK_API_URL: backend.feedbackApiUrl,
            VITE_GATEWAY_URL: backend.gatewayUrl,
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
