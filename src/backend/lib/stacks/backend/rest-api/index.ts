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
import { LabsPythonFunction, LabsPythonLayerVersion } from "../../../common/constructs/lambda";

interface LabsRestApiProps {
    urls: string[];
    vpc?: ec2.Vpc;
    securityGroup?: ec2.SecurityGroup;
    userPool: cognito.UserPool;
    regionalWebAclArn: string;
}

export class LabsRestApi extends Construct {
    public readonly restApi: apigateway.LambdaRestApi;

    constructor(scope: Construct, id: string, props: LabsRestApiProps) {
        super(scope, id);

        const powertoolsLayer = new LabsPythonLayerVersion(this, "powertoolsLayer", {
            entry: path.join(__dirname, "..", "..", "..", "common", "layers", "powertools"),
        });

        const pythonProxyFunction = new LabsPythonFunction(this, "pythonProxyFunction", {
            entry: path.join(__dirname, "proxy-function"),
            layers: [powertoolsLayer],
            environment: {
                ALLOWED_ORIGINS: JSON.stringify(props.urls),
            },
            memorySize: 1024,
            timeout: Duration.minutes(2),
            ...(props.vpc && {
                vpc: props.vpc,
                vpcSubnets: {
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
                securityGroups: [props.securityGroup!],
            }),
        });

        this.restApi = new apigateway.LambdaRestApi(this, "restApi", {
            handler: pythonProxyFunction,
            proxy: true,
            defaultMethodOptions: {
                authorizationType: apigateway.AuthorizationType.COGNITO,
                authorizer: new apigateway.CognitoUserPoolsAuthorizer(this, "authorizer", {
                    cognitoUserPools: [props.userPool],
                    identitySource: "method.request.header.Authorization",
                }),
            },
            defaultCorsPreflightOptions: {
                allowCredentials: true,
                allowOrigins: props.urls,
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
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                metricsEnabled: true,
                dataTraceEnabled: true,
            },
            cloudWatchRole: true,
            cloudWatchRoleRemovalPolicy: RemovalPolicy.DESTROY,
        });
        NagSuppressions.addResourceSuppressions(
            this.restApi,
            [
                {
                    id: "AwsSolutions-IAM4",
                    reason: "LambdaRestApi requires the AmazonAPIGatewayPushToCloudWatchLogs policy for logging.",
                },
            ],
            true
        );

        new apigateway.RequestValidator(this, "requestValidator", {
            restApi: this.restApi,
            validateRequestBody: true,
            validateRequestParameters: true,
        });

        new waf.CfnWebACLAssociation(this, "restApiWebAclAssociation", {
            resourceArn: this.restApi.deploymentStage.stageArn,
            webAclArn: props.regionalWebAclArn,
        });
    }
}
