import { StackProps } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { LabsStack } from "../../common/constructs/stack";
import { LabsAuth } from "./auth";
import { LabsGraphApi } from "./graph-api";
import { LabsRestApi } from "./rest-api";
import { LabsStorage } from "./storage";
import { LabsVpc } from "./vpc";

interface BackendStackProps extends StackProps {
    urls: string[];
}

export class BackendStack extends LabsStack {
    public readonly environmentVariables: Record<string, string>;

    constructor(scope: Construct, id: string, props: BackendStackProps) {
        super(scope, id, props);

        const labsVpc = new LabsVpc(this, "vpc");

        const labsAuth = new LabsAuth(this, "auth", {
            urls: props.urls,
        });

        const labsGraphApi = new LabsGraphApi(this, "graphApi", {
            userPool: labsAuth.userPool,
            regionalWebAclArn: labsAuth.regionalWebAclArn,
            vpc: labsVpc.vpc,
            securityGroup: labsVpc.securityGroup,
        });

        const labsRestApi = new LabsRestApi(this, "restApi", {
            urls: props.urls,
            userPool: labsAuth.userPool,
            regionalWebAclArn: labsAuth.regionalWebAclArn,
            vpc: labsVpc.vpc,
            securityGroup: labsVpc.securityGroup,
        });
        NagSuppressions.addStackSuppressions(this, [
            {
                id: "AwsSolutions-IAM4",
                reason: "Lambda functions require managed policies to interface with the vpc.",
            },
        ]);

        const labsStorage = new LabsStorage(this, "storage", {
            urls: props.urls,
        });
        labsStorage.storageBucket.grantReadWrite(labsAuth.authenticatedRole);

        this.environmentVariables = {
            VITE_REGION: this.region!,
            VITE_CALLBACK_URL: props.urls[0],
            VITE_USER_POOL_ID: labsAuth.userPool.userPoolId,
            ...(labsAuth.userPoolDomain && {
                VITE_USER_POOL_DOMAIN_URL: labsAuth.userPoolDomain
                    .baseUrl()
                    .replace("https://", ""),
            }),
            VITE_USER_POOL_CLIENT_ID: labsAuth.userPoolClient.userPoolClientId,
            VITE_IDENTITY_POOL_ID: labsAuth.identityPool.attrId,
            CODEGEN_GRAPH_API_ID: labsGraphApi.graphApi.apiId,
            VITE_GRAPH_API_URL: labsGraphApi.graphApi.graphqlUrl,
            VITE_REST_API_URL: labsRestApi.restApi.url,
            VITE_STORAGE_BUCKET_NAME: labsStorage.storageBucket.bucketName,
        };
    }
}
