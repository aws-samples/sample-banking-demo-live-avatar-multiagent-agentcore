import { Aspects, Stage, StageProps } from "aws-cdk-lib";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { Auth } from "./stacks/auth";
import { Frontend, FrontendDeployment } from "./stacks/frontend";

export class ApplicationStage extends Stage {
    constructor(scope: Construct, id: string, props?: StageProps) {
        super(scope, id, props);

        const frontend = new Frontend(this, "Frontend");

        const auth = new Auth(this, "Auth", {
            urls: frontend.urls,
        });

        const environmentVariables = {
            VITE_REGION: this.region!,
            VITE_STAGE: this.stageName || "",
            VITE_BUILD_VERSION: process.env.npm_package_version || "",
            VITE_CALLBACK_URL: frontend.urls[0],
            VITE_USER_POOL_ID: auth.userPool.userPoolId,
            ...(auth.userPoolDomain && {
                VITE_USER_POOL_DOMAIN_URL: auth.userPoolDomain.baseUrl().replace("https://", ""),
            }),
            VITE_USER_POOL_CLIENT_ID: auth.userPoolClient.userPoolClientId,
            VITE_IDENTITY_POOL_ID: auth.identityPool.identityPoolId,
        };

        // this stack must be named FrontendDeployment
        new FrontendDeployment(this, "FrontendDeployment", {
            websiteBucket: frontend.websiteBucket,
            distribution: frontend.distribution,
            websiteAsset: frontend.websiteAsset,
            environmentVariables,
        });

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
            ],
            true
        );
        Aspects.of(this).add(new AwsSolutionsChecks());
    }
}
