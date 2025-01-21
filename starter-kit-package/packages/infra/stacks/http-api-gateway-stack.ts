import { CfnOutput, CfnResource, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CDKProps } from "../config/AppConfig";
import { HttpJwtAuthorizer, HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { CfnStage, CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { NagSuppressions } from "cdk-nag";
import { UserPool, UserPoolClient } from "aws-cdk-lib/aws-cognito";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { Cors } from "aws-cdk-lib/aws-apigateway";
import { Role, ServicePrincipal, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Vpc, SecurityGroup, SubnetType } from "aws-cdk-lib/aws-ec2";
import * as path from "path";
interface HttpApiGatewayStackProps extends CDKProps {
    userPool: UserPool;
    userPoolClient: UserPoolClient;
    distributionDomainName: string;
    vpc: Vpc;
    defaultSecurityGroup: SecurityGroup;
}

export class HttpApiGatewayStack extends Stack {
    constructor(scope: Construct, id: string, props: HttpApiGatewayStackProps) {
        super(scope, id, props);
        const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${props.userPool.userPoolId}`;

        const jwtAuthorizer = new HttpJwtAuthorizer(
            props.projectName + "-jwt-auth",
            issuer,
            {
                jwtAudience: [props.userPoolClient.userPoolClientId],
            }
        );

        const userPoolAuthorizer = new HttpUserPoolAuthorizer(props.projectName + "-user-pool-auth", props.userPool, {
            userPoolClients: [props.userPoolClient]
        })

        // typescript lambda
        const tsLambda = new NodejsFunction(this, `${props.projectName}-ts-lambda`, {
            functionName: `${props.projectName}-ts-lambda`,
            runtime: Runtime.NODEJS_20_X,
            entry: path.join(__dirname, "..", "lambda", "typescript", "ts-lambda", "index.ts"),
            handler: "index.handler",
            bundling: {
                externalModules: ['aws-sdk',],// Use the 'aws-sdk' available in the Lambda runtime
                // we want to use ESM instead of CJS
                format: OutputFormat.ESM
            },
            vpc: props.vpc,
            vpcSubnets: {
                subnetType: SubnetType.PRIVATE_WITH_EGRESS,
            },
            securityGroups: [props.defaultSecurityGroup],
        })

        const httpApiGateway = new HttpApi(this, `${props.projectName}-http-api`, {
            apiName: `${props.projectName}-http-api`,
            defaultAuthorizer: jwtAuthorizer,
            corsPreflight: {
                allowHeaders: Cors.DEFAULT_HEADERS,
                allowMethods: [
                    CorsHttpMethod.OPTIONS,
                    CorsHttpMethod.GET,
                    CorsHttpMethod.POST,
                ],
                allowCredentials: true,
                allowOrigins: ["http://localhost:3000", `https://${props.distributionDomainName}`],
            },
        });

        httpApiGateway.addRoutes({
            integration: new HttpLambdaIntegration('ts-test-lambda', tsLambda),
            path: '/test',
            authorizer: userPoolAuthorizer,
            methods: [HttpMethod.POST],
        });

        // add route for /content
        httpApiGateway.addRoutes({
            path: "/content",
            authorizer: jwtAuthorizer,
            methods: [HttpMethod.POST],
            integration: new HttpLambdaIntegration("ts-lambda-integration",
                tsLambda
            ),
        });

        // Setup the access log for APIGWv2
        const accessLogs = new LogGroup(this, `${props.projectName}-api-logs`)

        const stage = httpApiGateway.defaultStage?.node.defaultChild as CfnStage
        stage.accessLogSettings = {
            destinationArn: accessLogs.logGroupArn,
            format: JSON.stringify({
                requestId: '$context.requestId',
                userAgent: '$context.identity.userAgent',
                sourceIp: '$context.identity.sourceIp',
                requestTime: '$context.requestTime',
                requestTimeEpoch: '$context.requestTimeEpoch',
                httpMethod: '$context.httpMethod',
                path: '$context.path',
                status: '$context.status',
                protocol: '$context.protocol',
                responseLength: '$context.responseLength',
                domainName: '$context.domainName'
            })
        }

        const apiGWLogWriterRole = new Role(this, 'ApiGWLogWriterRole', {
            assumedBy: new ServicePrincipal('apigateway.amazonaws.com')
        })

        const policy = new PolicyStatement({
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:DescribeLogGroups',
                'logs:DescribeLogStreams',
                'logs:PutLogEvents',
                'logs:GetLogEvents',
                'logs:FilterLogEvents'
            ],
            resources: [`arn:aws:apigateway:${this.region}::/apis/*`]
        })

        apiGWLogWriterRole.addToPolicy(policy)
        accessLogs.grantWrite(apiGWLogWriterRole)


        NagSuppressions.addResourceSuppressions(
            tsLambda,
            [
                {
                    id: "AwsSolutions-IAM4",
                    reason: "Using default role for demo purposes. This lambda must use a specific role tailored to its function",
                },
                {
                    id: "AwsSolutions-L1",
                    reason: "Deliberately setting to use latest version -1 to ensure compatibility for demos.",
                },
            ],
            true
        );



        NagSuppressions.addResourceSuppressions(
            apiGWLogWriterRole,
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "Logging policy permissive to accommodate future API routes",
                },
            ],
            true
        );


        new CfnOutput(this, "config-apigateway-api-url-output", {
            value: httpApiGateway.apiEndpoint,
            description: "api http endpoint",
            exportName: `${props.projectName}-config-apigateway-api-url-output`,
        });


    }
}