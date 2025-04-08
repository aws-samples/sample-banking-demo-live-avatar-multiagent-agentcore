import { AmplifyData, AmplifyDataDefinition } from "@aws-amplify/data-construct";
import {
    Duration,
    aws_appsync as appsync,
    aws_cognito as cognito,
    aws_ec2 as ec2,
    aws_logs as logs,
    aws_wafv2 as waf,
} from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";
import { CommonNodejsFunction } from "../../../common/constructs/lambda";

interface GraphApiProps {
    vpc?: ec2.Vpc;
    securityGroup?: ec2.SecurityGroup;
    userPool: cognito.UserPool;
    regionalWebAclArn: string;
}

export class GraphApi extends Construct {
    public readonly graphApi: AmplifyData;

    constructor(scope: Construct, id: string, props: GraphApiProps) {
        super(scope, id);

        const { vpc, securityGroup, userPool, regionalWebAclArn } = props;

        const resolverFunction = new CommonNodejsFunction(this, "resolverFunction", {
            entry: path.join(__dirname, "resolver-function", "index.ts"),
            memorySize: 1024,
            timeout: Duration.minutes(2),
            ...(vpc && {
                vpc: vpc,
                vpcSubnets: {
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
                securityGroups: [securityGroup!],
            }),
        });

        const graphApi = new AmplifyData(this, "graphApi", {
            definition: AmplifyDataDefinition.fromFiles(path.join(__dirname, "schema.graphql")),
            authorizationModes: {
                defaultAuthorizationMode: "AMAZON_COGNITO_USER_POOLS",
                userPoolConfig: {
                    userPool: userPool,
                },
                iamConfig: {
                    enableIamAuthorizationMode: true,
                },
            },
            logging: {
                fieldLogLevel: appsync.FieldLogLevel.ALL,
                retention: logs.RetentionDays.THREE_MONTHS,
                excludeVerboseContent: false,
            },
            functionNameMap: {
                resolverLambda: resolverFunction,
            },
        });
        NagSuppressions.addResourceSuppressions(
            graphApi,
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

        resolverFunction.addEnvironment("GRAPH_API_URL", graphApi.graphqlUrl);
        graphApi.resources.graphqlApi.grantMutation(resolverFunction);
        graphApi.resources.graphqlApi.grantQuery(resolverFunction);

        graphApi.resources.cfnResources.cfnGraphqlApi.xrayEnabled = true;
        Object.values(graphApi.resources.cfnResources.cfnTables).forEach((table) => {
            table.pointInTimeRecoverySpecification = {
                pointInTimeRecoveryEnabled: true,
            };
        });

        new waf.CfnWebACLAssociation(this, "graphApiWebAclAssociation", {
            resourceArn: graphApi.resources.graphqlApi.arn,
            webAclArn: regionalWebAclArn,
        });

        this.graphApi = graphApi;
    }
}
