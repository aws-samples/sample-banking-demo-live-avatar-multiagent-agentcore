import { aws_apigateway as apigateway, Duration, RemovalPolicy } from "aws-cdk-lib";
import {
    AuthorizationType,
    CognitoUserPoolsAuthorizer,
    Cors,
    LambdaIntegration,
    LogGroupLogDestination,
    MethodLoggingLevel,
    RequestValidator,
} from "aws-cdk-lib/aws-apigateway";
import { UserPool } from "aws-cdk-lib/aws-cognito";
import { SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";
import { CommonPythonFunction } from "../../../common/constructs/lambda";

interface RestApiProps {
    urls: string[];
    vpc?: Vpc;
    securityGroup?: SecurityGroup;
    userPool: UserPool;
    regionalWebAclArn: string;
}

export class RestApi extends Construct {
    public readonly restApi: apigateway.LambdaRestApi;

    constructor(scope: Construct, id: string, props: RestApiProps) {
        super(scope, id);

        const { urls, vpc, securityGroup, userPool, regionalWebAclArn } = props;

        const restApi = new apigateway.RestApi(this, "restApi", {
            defaultMethodOptions: {
                authorizationType: AuthorizationType.COGNITO,
                authorizer: new CognitoUserPoolsAuthorizer(this, "authorizer", {
                    cognitoUserPools: [userPool],
                    identitySource: "method.request.header.Authorization",
                }),
            },
            defaultCorsPreflightOptions: {
                allowCredentials: true,
                allowOrigins: urls,
                allowMethods: Cors.ALL_METHODS,
                allowHeaders: Cors.DEFAULT_HEADERS,
            },
            deployOptions: {
                accessLogDestination: new LogGroupLogDestination(
                    new LogGroup(this, "restApiLogGroup", {
                        removalPolicy: RemovalPolicy.DESTROY,
                        retention: RetentionDays.THREE_MONTHS,
                    })
                ),
                loggingLevel: MethodLoggingLevel.ERROR,
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
                    reason: "RestApi requires the AmazonAPIGatewayPushToCloudWatchLogs policy for logging.",
                },
            ],
            true
        );

        const proxyFunction = new CommonPythonFunction(this, "proxyFunction", {
            entry: path.join(__dirname, "proxy"),
            environment: {
                ALLOWED_ORIGINS: JSON.stringify(urls),
            },
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

        restApi.root.addProxy({
            defaultIntegration: new LambdaIntegration(proxyFunction),
        });

        new RequestValidator(this, "requestValidator", {
            restApi,
            validateRequestBody: true,
            validateRequestParameters: true,
        });

        new CfnWebACLAssociation(this, "restApiWebAclAssociation", {
            resourceArn: restApi.deploymentStage.stageArn,
            webAclArn: regionalWebAclArn,
        });

        this.restApi = restApi;
    }
}
