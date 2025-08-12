import { StackProps } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { CommonStack } from "../../common/constructs/stack";
import { Auth } from "./auth";
import { GraphApi } from "./graph-api";
import { Networking } from "./networking";
import { RestApi } from "./rest-api";
import { Storage } from "./storage";

interface BackendProps extends StackProps {
    urls: string[];
}

export class Backend extends CommonStack {
    public readonly environmentVariables: Record<string, string>;

    constructor(scope: Construct, id: string, props: BackendProps) {
        super(scope, id, props);

        const { urls } = props;

        const networking = new Networking(this, "networking");

        const auth = new Auth(this, "auth", {
            urls,
        });

        const storage = new Storage(this, "storage", {
            urls,
        });
        storage.storageBucket.grantReadWrite(auth.identityPool.authenticatedRole);

        const graphApi = new GraphApi(this, "graphApi", {
            userPool: auth.userPool,
            regionalWebAclArn: auth.regionalWebAclArn,
            vpc: networking.vpc,
            securityGroup: networking.securityGroup,
        });

        const restApi = new RestApi(this, "restApi", {
            urls,
            userPool: auth.userPool,
            regionalWebAclArn: auth.regionalWebAclArn,
            vpc: networking.vpc,
            securityGroup: networking.securityGroup,
        });
        NagSuppressions.addStackSuppressions(this, [
            {
                id: "AwsSolutions-IAM4",
                reason: "Lambda functions require managed policies to interface with the vpc.",
            },
        ]);

        this.environmentVariables = {
            VITE_REGION: this.region!,
            VITE_CALLBACK_URL: urls[0],
            VITE_USER_POOL_ID: auth.userPool.userPoolId,
            ...(auth.userPoolDomain && {
                VITE_USER_POOL_DOMAIN_URL: auth.userPoolDomain.baseUrl().replace("https://", ""),
            }),
            VITE_USER_POOL_CLIENT_ID: auth.userPoolClient.userPoolClientId,
            VITE_IDENTITY_POOL_ID: auth.identityPool.identityPoolId,
            CODEGEN_GRAPH_API_ID: graphApi.amplifiedGraphApi.apiId,
            VITE_GRAPH_API_URL: graphApi.amplifiedGraphApi.graphqlUrl,
            VITE_REST_API_URL: restApi.restApi.url,
            VITE_STORAGE_BUCKET_NAME: storage.storageBucket.bucketName,
        };
    }
}
