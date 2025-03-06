import { Aspects, Stage, StageProps } from "aws-cdk-lib";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { LogsRetentionAspect } from "./aspects/logs";
import { AuthStack } from "./stacks/auth";
import { FrontendBuildStack, FrontendStack } from "./stacks/frontend";
import { GraphApiStack } from "./stacks/graph-api";
import { RestApiStack } from "./stacks/rest-api";
import { StorageHydrateStack, StorageStack } from "./stacks/storage";
import { VpcStack } from "./stacks/vpc";

export class ApplicationStage extends Stage {
    constructor(scope: Construct, id: string, props: StageProps) {
        super(scope, id, props);

        const vpcStack = new VpcStack(this, "vpc", {});

        const frontendStack = new FrontendStack(this, "frontend", {});

        const authStack = new AuthStack(this, "auth", {
            urls: frontendStack.urls,
        });

        const stackSuppressions = [
            {
                id: "AwsSolutions-IAM4",
                reason: "Lambda functions require managed policies to interface with the vpc.",
            },
        ];

        const graphApiStack = new GraphApiStack(this, "graphApi", {
            userPool: authStack.userPool,
            regionalWebAclArn: authStack.regionalWebAclArn,
            vpc: vpcStack.vpc,
            securityGroup: vpcStack.securityGroup,
        });
        NagSuppressions.addStackSuppressions(graphApiStack, stackSuppressions);

        const restApiStack = new RestApiStack(this, "restApi", {
            urls: frontendStack.urls,
            userPool: authStack.userPool,
            regionalWebAclArn: authStack.regionalWebAclArn,
            vpc: vpcStack.vpc,
            securityGroup: vpcStack.securityGroup,
        });
        NagSuppressions.addStackSuppressions(restApiStack, stackSuppressions);

        const storageStack = new StorageStack(this, "storage", {
            urls: frontendStack.urls,
        });
        storageStack.storageBucket.grantReadWrite(authStack.authenticatedRole);

        new StorageHydrateStack(this, "storageHydrate", {
            storageBucket: storageStack.storageBucket,
        });

        // this stack must be named frontendBuild
        new FrontendBuildStack(this, "frontendBuild", {
            websiteBucket: frontendStack.websiteBucket,
            urls: frontendStack.urls,
            userPoolId: authStack.userPool.userPoolId,
            userPoolDomainUrl: authStack.userPool.userPoolDomainUrl,
            userPoolClientId: authStack.userPoolClient.userPoolClientId,
            identityPoolId: authStack.identityPool.attrId,
            graphApiUrl: graphApiStack.graphApi.graphqlUrl,
            graphApiId: graphApiStack.graphApi.apiId,
            restApiUrl: restApiStack.restApi.url,
            storageBucketName: storageStack.storageBucket.bucketName,
            distribution: frontendStack.distribution,
        });

        Aspects.of(this).add(new LogsRetentionAspect(RetentionDays.THREE_MONTHS));

        NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: "AwsSolutions-IAM4",
                    reason: "Lambda functions require the AWSLambdaBasicExecutionRole to write logs to CloudWatch.",
                    appliesTo: [
                        "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
                    ],
                },
                {
                    id: "AwsSolutions-IAM5",
                    reason: "High-level constructs require wildcards for dynamic resource creation and management.",
                },
                {
                    id: "AwsSolutions-L1",
                    reason: "High-level constructs set their own runtimes.",
                },
            ],
            true
        );
        Aspects.of(this).add(new AwsSolutionsChecks());
    }
}
