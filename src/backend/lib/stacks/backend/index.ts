import { StackProps } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { CommonStack } from "../../common/constructs/stack";
import { Auth } from "./auth";
import { GraphApi } from "./graph-api";
import { RestApi } from "./rest-api";
import { Storage } from "./storage";
import { Vpc } from "./vpc";

interface BackendStackProps extends StackProps {
    urls: string[];
}

export class BackendStack extends CommonStack {
    public readonly environmentVariables: Record<string, string>;

    constructor(scope: Construct, id: string, props: BackendStackProps) {
        super(scope, id, props);

        const vpc = new Vpc(this, "vpc");

        const auth = new Auth(this, "auth", {
            urls: props.urls,
        });

        const graphApi = new GraphApi(this, "graphApi", {
            userPool: auth.userPool,
            regionalWebAclArn: auth.regionalWebAclArn,
            vpc: vpc.vpc,
            securityGroup: vpc.securityGroup,
        });

        const restApi = new RestApi(this, "restApi", {
            urls: props.urls,
            userPool: auth.userPool,
            regionalWebAclArn: auth.regionalWebAclArn,
            vpc: vpc.vpc,
            securityGroup: vpc.securityGroup,
        });
        NagSuppressions.addStackSuppressions(this, [
            {
                id: "AwsSolutions-IAM4",
                reason: "Lambda functions require managed policies to interface with the vpc.",
            },
        ]);

        const storage = new Storage(this, "storage", {
            urls: props.urls,
        });
        storage.storageBucket.grantReadWrite(auth.authenticatedRole);

        this.environmentVariables = {
            VITE_REGION: this.region!,
            VITE_CALLBACK_URL: props.urls[0],
            VITE_USER_POOL_ID: auth.userPool.userPoolId,
            ...(auth.userPoolDomain && {
                VITE_USER_POOL_DOMAIN_URL: auth.userPoolDomain.baseUrl().replace("https://", ""),
            }),
            VITE_USER_POOL_CLIENT_ID: auth.userPoolClient.userPoolClientId,
            VITE_IDENTITY_POOL_ID: auth.identityPool.attrId,
            CODEGEN_GRAPH_API_ID: graphApi.amplifiedGraphApi.apiId,
            VITE_GRAPH_API_URL: graphApi.amplifiedGraphApi.graphqlUrl,
            VITE_REST_API_URL: restApi.restApi.url,
            VITE_STORAGE_BUCKET_NAME: storage.storageBucket.bucketName,
        };
    }
}
