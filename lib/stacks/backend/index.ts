import { StackProps, Stage } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Stack } from "../../common/constructs/stack";
import { Auth } from "./constructs/auth";

interface BackendProps extends StackProps {
    urls: string[];
}

export class Backend extends Stack {
    public readonly environmentVariables: Record<string, string>;

    constructor(scope: Construct, id: string, props: BackendProps) {
        super(scope, id, props);

        const { urls } = props;

        const auth = new Auth(this, "auth", {
            urls,
        });

        this.environmentVariables = {
            VITE_REGION: this.region!,
            VITE_STAGE: Stage.of(this)?.stageName || "unknown",
            VITE_BUILD_TIMESTAMP: new Date().toISOString(),
            VITE_BUILD_VERSION: process.env.npm_package_version || "0.0.0",
            VITE_CALLBACK_URL: urls[0],
            VITE_USER_POOL_ID: auth.userPool.userPoolId,
            ...(auth.userPoolDomain && {
                VITE_USER_POOL_DOMAIN_URL: auth.userPoolDomain.baseUrl().replace("https://", ""),
            }),
            VITE_USER_POOL_CLIENT_ID: auth.userPoolClient.userPoolClientId,
            VITE_IDENTITY_POOL_ID: auth.identityPool.identityPoolId,
        };
    }
}
