import { CfnOutput, CfnResource, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CDKProps, lambdaBundlerImage, lambdaRuntime } from "../config/AppConfig";
import { AuthorizationType, CfnAuthorizer, Cors, LambdaIntegration, MethodLoggingLevel, RestApi } from "aws-cdk-lib/aws-apigateway";
import { CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import * as path from "path";
import { NagSuppressions } from "cdk-nag";
import { Vpc, SecurityGroup, SubnetType } from "aws-cdk-lib/aws-ec2";
import { Role } from "aws-cdk-lib/aws-iam";
interface RestApiGatewayStackProps extends CDKProps {
    userPoolARN: string
    distributionDomainName: string;
    regionalWebAclArn: string;
    vpc: Vpc;
    defaultSecurityGroup: SecurityGroup;
}

export class RestApiGatewayStack extends Stack {
    constructor(scope: Construct, id: string, props: RestApiGatewayStackProps) {
        super(scope, id, props);

        const stageName = "dev";

        const restAPI = new RestApi(this, `${props.projectName}-rest-api`, {
            restApiName: `${props.projectName}-rest-api`,
            cloudWatchRole: true,
            cloudWatchRoleRemovalPolicy: RemovalPolicy.DESTROY, // to avoid stack re-deployment failures
            deployOptions: {
                stageName,
                metricsEnabled: true,
                loggingLevel: MethodLoggingLevel.INFO,
                dataTraceEnabled: true,
            },
            defaultCorsPreflightOptions: {
                allowHeaders: Cors.DEFAULT_HEADERS,
                allowMethods: [
                    CorsHttpMethod.OPTIONS,
                    CorsHttpMethod.GET,
                    CorsHttpMethod.POST,
                ],
                allowCredentials: true,
                allowOrigins: ["http://localhost:3000", `https://${props.distributionDomainName}`],
            },
        })

        const cfnAuthorizer = new CfnAuthorizer(this, `${props.projectName}-authorizer`, {
            restApiId: restAPI.restApiId,
            type: 'COGNITO_USER_POOLS',
            name: stageName + '_cognitoauthorizer',
            providerArns: [props.userPoolARN], // userPoolArn is userPool.arn value
            identitySource: 'method.request.header.Authorization',
        });


        // python function 
        const pythonFunction = new Function(this, `${props.projectName}-lambda`, {
            code: Code.fromAsset(path.join(__dirname, "..", "lambda", "python", "python-lambda"), {
                bundling: {
                    image: lambdaBundlerImage,
                    command: [
                        "bash",
                        "-c",
                        "pip install -r requirements.txt -t /asset-output && cp -au . /asset-output",
                    ],
                }
            }),
            runtime: lambdaRuntime,
            handler: "index.handler",
            timeout: Duration.seconds(30),
            vpc: props.vpc,
            vpcSubnets: {
                subnetType: SubnetType.PRIVATE_WITH_EGRESS,
            },
            securityGroups: [props.defaultSecurityGroup],
        });

        const testResource = restAPI.root.addResource("test");
        var testsEndpoint = testResource.addMethod('POST', new LambdaIntegration(pythonFunction, {
            proxy: true,
        }));
        // add route for /test
        const resourceGetTestsEndpoint = testsEndpoint.node.findChild('Resource');
        (resourceGetTestsEndpoint as CfnResource).addPropertyOverride('AuthorizationType', AuthorizationType.COGNITO);
        (resourceGetTestsEndpoint as CfnResource).addPropertyOverride('AuthorizerId', { Ref: cfnAuthorizer.logicalId });


        new CfnWebACLAssociation(this, `${props.projectName}-webacl-rest-api-association`, {
            resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${restAPI.restApiId}/stages/${restAPI.deploymentStage.stageName}`,
            webAclArn: props.regionalWebAclArn,
        });


        NagSuppressions.addResourceSuppressions(
            pythonFunction,
            [
                {
                    id: "AwsSolutions-IAM4",
                    reason: "Using default role for demo purposes. This lambda must use a specific role tailored to its function",
                },
                {
                    id: "AwsSolutions-L1",
                    reason: "Deliberately setting to use latest version -1 to ensure compatibility for demos.",
                },
            ])

        NagSuppressions.addResourceSuppressions(
            restAPI,
            [
                {
                    id: "AwsSolutions-APIG1",
                    reason: "access logging enabled - work in progress",
                },
                {
                    id: "AwsSolutions-APIG2",
                    reason: "request validation - work in progress",
                },
                {
                    id: "AwsSolutions-APIG4",
                    reason: "auth integration - work in progress",
                },
                {
                    id: "AwsSolutions-COG4",
                    reason: "auth integration - work in progress",
                },

            ],
            true
        );


        new CfnOutput(this, "config-apigateway-rest-api-url-output", {
            value: restAPI.url,
            description: "api http endpoint",
            exportName: `${props.projectName}-config-apigateway-rest-api-url-output`,
        });

    }
}