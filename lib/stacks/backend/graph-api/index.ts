import {
    AmplifyData,
    AmplifyDataDefinition,
    FieldLogLevel,
    RetentionDays,
} from "@aws-amplify/data-construct";
import { Duration } from "aws-cdk-lib";
import { MappingTemplate } from "aws-cdk-lib/aws-appsync";
import { UserPool } from "aws-cdk-lib/aws-cognito";
import { SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";
import { CommonNodejsFunction } from "../../../common/constructs/lambda";

interface GraphApiProps {
    vpc?: Vpc;
    securityGroup?: SecurityGroup;
    userPool: UserPool;
    regionalWebAclArn: string;
}

export class GraphApi extends Construct {
    public readonly amplifiedGraphApi: AmplifyData;

    constructor(scope: Construct, id: string, props: GraphApiProps) {
        super(scope, id);

        const { vpc, securityGroup, userPool, regionalWebAclArn } = props;

        const amplifiedGraphApi = new AmplifyData(this, "amplifiedGraphApi", {
            definition: AmplifyDataDefinition.fromFiles(path.join(__dirname, "schema.graphql")),
            authorizationModes: {
                defaultAuthorizationMode: "AMAZON_COGNITO_USER_POOLS",
                userPoolConfig: {
                    userPool,
                },
                iamConfig: {
                    enableIamAuthorizationMode: true,
                },
            },
            logging: {
                fieldLogLevel: FieldLogLevel.ALL,
                retention: RetentionDays.THREE_MONTHS,
                excludeVerboseContent: false,
            },
        });
        NagSuppressions.addResourceSuppressions(
            amplifiedGraphApi,
            [
                {
                    id: "AwsSolutions-IAM4",
                    reason: "AmplifyGraphqlApi requires the AWSAppSyncPushToCloudWatchLogs policy for logging.",
                },
                {
                    id: "AwsSolutions-S1",
                    reason: "AmplifyGraphqlApi-created buckets do not require server access logs.",
                },
                {
                    id: "AwsSolutions-S10",
                    reason: "AmplifyGraphqlApi-created buckets do not require requests to use SSL.",
                },
            ],
            true
        );
        amplifiedGraphApi.resources.cfnResources.cfnGraphqlApi.xrayEnabled = true;
        Object.values(amplifiedGraphApi.resources.cfnResources.cfnTables).forEach((table) => {
            table.pointInTimeRecoverySpecification = {
                pointInTimeRecoveryEnabled: true,
            };
        });

        const resolverFunction = new CommonNodejsFunction(this, "resolverFunction", {
            entry: path.join(__dirname, "resolver.ts"),
            memorySize: 1024,
            timeout: Duration.minutes(2),
            ...(vpc && {
                vpc,
                vpcSubnets: {
                    subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                },
                securityGroups: [securityGroup!],
            }),
        });

        amplifiedGraphApi
            .addLambdaDataSource("lambdaDataSource", resolverFunction)
            .createResolver("resolver", {
                typeName: "Mutation",
                fieldName: "testMessage",
                requestMappingTemplate: MappingTemplate.lambdaRequest(),
                responseMappingTemplate: MappingTemplate.lambdaResult(),
            });

        new CfnWebACLAssociation(this, "graphApiWebAclAssociation", {
            resourceArn: amplifiedGraphApi.resources.graphqlApi.arn,
            webAclArn: regionalWebAclArn,
        });

        this.amplifiedGraphApi = amplifiedGraphApi;
    }
}
