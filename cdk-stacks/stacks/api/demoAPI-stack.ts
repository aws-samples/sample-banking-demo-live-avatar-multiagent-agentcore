// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { NestedStack, NestedStackProps, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";

import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigw2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigw2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as apigw2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { CfnStage } from "aws-cdk-lib/aws-apigatewayv2";
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NagSuppressions } from 'cdk-nag';

export interface DemoAPIStackProps extends NestedStackProps {
  readonly cognitoUserPool: cognito.IUserPool;
  readonly cognitoUserPoolClient: cognito.IUserPoolClient;
  readonly cdkAppName: string;
  readonly demoTable: dynamodb.Table;
}

export class DemoAPIStack extends NestedStack {

  public readonly demoAPI: apigw2.IHttpApi;

  constructor(scope: Construct, id: string, props: DemoAPIStackProps) {
    super(scope, id, props);


    const exampleDemoLambda = new nodeLambda.NodejsFunction(this, 'ExampleDemoLambda', {
      functionName: `${props.cdkAppName}-ExampleDemoLambda`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'lambdas/handlers/DemoAPI/exampleDemo.ts',
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        "APPLICATION_VERSION": `v${this.node.tryGetContext('application_version')} (${new Date().toISOString()})`,
        "DEMO_TABLE_ARN": props.demoTable.tableArn,
        "DEMO_TABLE_NAME": props.demoTable.tableName
      }
    });
    props.demoTable.grantReadWriteData(exampleDemoLambda)


    // Suppress the AwsSolutions-IAM4 rule for the entire DemoAPIStack
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'The AWSLambdaBasicExecutionRole is required for the Lambda function to log to CloudWatch.'
      }
    ]);

    /************* create DemoAPI Integration *********/

    // Create an IAM authorizer as default auth
    const iamAuthorizer = new apigw2Authorizers.HttpIamAuthorizer();

    const demoAPI = new apigw2.HttpApi(this, 'DemoAPI', {
      apiName: `${props.cdkAppName}-DemoAPI`,
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [apigw2.CorsHttpMethod.GET, apigw2.CorsHttpMethod.POST, apigw2.CorsHttpMethod.PUT, apigw2.CorsHttpMethod.DELETE],
        allowHeaders: apigw.Cors.DEFAULT_HEADERS,
      },
      defaultAuthorizer: iamAuthorizer
    });
    

    const demoAPIAuthorizer = new apigw2Authorizers.HttpUserPoolAuthorizer('DemoAPIAuthorizer', props.cognitoUserPool, {
      userPoolClients: [props.cognitoUserPoolClient],
    });
    

    // Setup the access log for APIGWv2
    const accessLogs = new logs.LogGroup(this, `${props.cdkAppName}-DemoAPI-AccessLogs`)

    const stage = demoAPI.defaultStage?.node.defaultChild as CfnStage
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

    const apiGWLogWriterRole = new iam.Role(this, 'ApiGWLogWriterRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com')
    })

    const policy = new iam.PolicyStatement({
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:DescribeLogGroups',
        'logs:DescribeLogStreams',
        'logs:PutLogEvents',
        'logs:GetLogEvents',
        'logs:FilterLogEvents'
      ],
      resources: ['*']
    })

    apiGWLogWriterRole.addToPolicy(policy)
    accessLogs.grantWrite(apiGWLogWriterRole)

    NagSuppressions.addResourceSuppressions([apiGWLogWriterRole], [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Recommended pattern for enabling read and write to CloudWatch logs. https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-logging.html'
      },
    ], true)

    demoAPI.addRoutes({
      integration: new apigw2Integrations.HttpLambdaIntegration('getExampleAPI', exampleDemoLambda),
      path: '/getExample',
      authorizer: demoAPIAuthorizer,
      methods: [apigw2.HttpMethod.GET],
    });

    this.demoAPI = demoAPI;

    new CfnOutput(this, "demoAPIId", {
      key: 'demoAPIId',
      value: this.demoAPI.apiId
    });

    new CfnOutput(this, "demoAPIEndpoint", {
      key: 'demoAPIEndpoint',
      value: this.demoAPI.apiEndpoint
    });

  }
}
