import {
    Duration,
    RemovalPolicy,
    aws_apigateway as apigateway,
    aws_cognito as cognito,
    aws_ec2 as ec2,
    aws_logs as logs,
    aws_wafv2 as waf,
} from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";
import { CommonPythonPowertoolsFunction } from "../../../common/constructs/lambda";

interface RestApiProps {
    urls: string[];
    vpc?: ec2.Vpc;
    securityGroup?: ec2.SecurityGroup;
    userPool: cognito.UserPool;
    regionalWebAclArn: string;
}

export class RestApi extends Construct {
    public readonly restApi: apigateway.LambdaRestApi;

    constructor(scope: Construct, id: string, props: RestApiProps) {
        super(scope, id);

        const { urls, vpc, securityGroup, userPool, regionalWebAclArn } = props;

        const proxyFunction = new CommonPythonPowertoolsFunction(this, "proxyFunction", {
            entry: path.join(__dirname, "proxy-function"),
            environment: {
                ALLOWED_ORIGINS: JSON.stringify(urls),
            },
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

        const restApi = new apigateway.RestApi(this, "restApi", {
            defaultMethodOptions: {
                authorizationType: apigateway.AuthorizationType.COGNITO,
                authorizer: new apigateway.CognitoUserPoolsAuthorizer(this, "authorizer", {
                    cognitoUserPools: [userPool],
                    identitySource: "method.request.header.Authorization",
                }),
            },
            defaultCorsPreflightOptions: {
                allowCredentials: true,
                allowOrigins: urls,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            },
            deployOptions: {
                accessLogDestination: new apigateway.LogGroupLogDestination(
                    new logs.LogGroup(this, "restApiLogGroup", {
                        removalPolicy: RemovalPolicy.DESTROY,
                        retention: logs.RetentionDays.THREE_MONTHS,
                    })
                ),
                loggingLevel: apigateway.MethodLoggingLevel.ERROR,
                metricsEnabled: true,
                dataTraceEnabled: false,
            },
            cloudWatchRole: true,
            cloudWatchRoleRemovalPolicy: RemovalPolicy.DESTROY,
        });
        NagSuppressions.addResourceSuppressions(
            restApi,
            [
                {
                    id: "AwsSolutions-IAM4",
                    reason: "LambdaRestApi requires the AmazonAPIGatewayPushToCloudWatchLogs policy for logging.",
                },
            ],
            true
        );

        restApi.root.addProxy({
            defaultIntegration: new apigateway.LambdaIntegration(proxyFunction),
        });

        new apigateway.RequestValidator(this, "requestValidator", {
            restApi: restApi,
            validateRequestBody: true,
            validateRequestParameters: true,
        });

        new waf.CfnWebACLAssociation(this, "restApiWebAclAssociation", {
            resourceArn: restApi.deploymentStage.stageArn,
            webAclArn: regionalWebAclArn,
        });

        this.restApi = restApi;
    }
}
