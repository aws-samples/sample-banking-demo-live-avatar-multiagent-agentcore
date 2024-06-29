// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';

import { FrontendS3DeploymentStack } from "../lib/frontend/frontend-s3-deployment-stack";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";

export interface CdkFrontendStackProps extends StackProps {
    readonly webAppBucket: s3.IBucket;
    readonly accessLogsBucket: s3.IBucket;
    readonly backendApiEndpoint: string;
    readonly backendApiId: string;
    readonly cognitoUserPoolId: string;
    readonly cognitoAppClientId: string;
    readonly cognitoDomainName: string;
}

export class CdkFrontendStack extends Stack {
    constructor(scope: Construct, id: string, props: CdkFrontendStackProps) {
        super(scope, id, props);

        const appName = 'GenAILabs-Demo';
        const webAppPath = 'demoWebApp';

        const frontendS3DeploymentStack = new FrontendS3DeploymentStack(this, "FrontendS3DeploymentStack", {
            cdkAppName: appName,
            webAppBucket: props.webAppBucket,
            accessLogsBucket: props.accessLogsBucket,
            webAppPath: webAppPath
        });

        const cfnOriginAccessControl = new cloudfront.CfnOriginAccessControl(this, `${appName}-CFOriginAccessControl`, {
            originAccessControlConfig: {
                name: `${appName}-CFOriginAccessControl`,
                originAccessControlOriginType: 's3',
                signingBehavior: 'always',
                signingProtocol: 'sigv4',
            },
        });

        // Store Cognito variables in SSM for Lambda@Edge (it doesn't support env variables)
        const cognitoConfig = JSON.stringify({
            'region': this.region,
            'userPoolId': props.cognitoUserPoolId,
            'userPoolAppId': props.cognitoAppClientId,
            'userPoolDomain': `${props.cognitoDomainName}.auth.us-east-1.amazoncognito.com`
         });
  
        // Create an SSM string parameter
        new ssm.StringParameter(this, 'CognitoConfig', {
            parameterName: '/genAiLabsDemo/cognitoConfig',
            stringValue: cognitoConfig
        });

        // Using this method since the midway-auth library may not be available in a pipeline
        const midwayAuthLambda = new cloudfront.experimental.EdgeFunction(this, 'MidwayAuthLambdaFn', {
            code: lambda.Code.fromAsset('build_lambda_midway_auth'),
            handler: 'midway-auth.handler',
            description: 'Midway lambda@edge function',
            runtime: lambda.Runtime.NODEJS_18_X,
            timeout: Duration.seconds(5),
        });
        // Add the necessary IAM policy to allow access to the SSM Parameter Store
        midwayAuthLambda.addToRolePolicy(
            new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ssm:GetParameter', 'ssm:GetParameters'],
            resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/genAiLabsDemo/cognitoConfig`],
            })
        );

        const midwayAuthLambdaAlias = new lambda.Alias(this, 'MidwayAuthLambdaAlias', {
            aliasName: midwayAuthLambda.functionName + '-Version',
            version: midwayAuthLambda.currentVersion
        });
        midwayAuthLambdaAlias.node.addDependency(midwayAuthLambda);

        // Suppress the AwsSolutions-IAM4 rule for the entire DemoAPIStack
        NagSuppressions.addStackSuppressions(this, [
            {
            id: 'AwsSolutions-IAM4',
            reason: 'The AWSLambdaBasicExecutionRole is required for the Lambda function to log to CloudWatch.'
            },
            {
                id: 'AwsSolutions-L1',
                reason: 'Does not apply to midway auth'
                }
        ]);

        const webAppCloudFrontDistribution = new cloudfront.Distribution(this, `${appName}-WebAppDistribution`, {
            defaultBehavior: {
                origin: new origins.S3Origin(props.webAppBucket,
                    {
                        originPath: `/${webAppPath}`,
                    }),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
                edgeLambdas: [{
                    functionVersion: midwayAuthLambdaAlias.version,
                    eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST
                  }],   
            },
            enableLogging: true,
            logBucket: props.accessLogsBucket,
            logIncludesCookies: false,
            logFilePrefix: "cfaccesslogs",
            errorResponses: [{
                httpStatus: 403,
                ttl: Duration.minutes(60),
                responsePagePath: "/index.html",
                responseHttpStatus: 200
            }],

        });

        props.webAppBucket.addToResourcePolicy(
            new PolicyStatement({
                actions: ['s3:GetObject'],
                principals: [new ServicePrincipal('cloudfront.amazonaws.com')],
                effect: Effect.ALLOW,
                resources: [`${props.webAppBucket.bucketArn}/*`],
            }
            )
        )

        // Add Origin Access Control to CloudFront Distribution 
        const cfnDistribution = webAppCloudFrontDistribution.node.defaultChild as cloudfront.CfnDistribution;
        cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity', '')
        cfnDistribution.addPropertyOverride(
            'DistributionConfig.Origins.0.OriginAccessControlId',
            cfnOriginAccessControl.attrId
        )


        NagSuppressions.addResourceSuppressions(webAppCloudFrontDistribution, [
            {
                id: "AwsSolutions-CFR4",
                reason: "Using CloudFront Provided Cert which defaults this to TLS1.  Hoping to avoid customer needing to provision cert just to deploy solution."
            }
        ]);
  

        /**************************************************************************************************************
         * CDK Outputs *
         **************************************************************************************************************/

        new CfnOutput(this, "webAppBucket", {
            key: "webAppBucket",
            value: props.webAppBucket.bucketName
        });

        new CfnOutput(this, "webAppPath", {
            key: "webAppPath",
            value: webAppPath
        });

        new CfnOutput(this, "accessLogBucket", {
            key: "accessLogBucket",
            value: props.accessLogsBucket.bucketName
        });

        new CfnOutput(this, "webAppURL", {
            key: "webAppURL",
            value: `https://${webAppCloudFrontDistribution.distributionDomainName}`
        });

        new CfnOutput(this, "cloudfrontDistributionId", {
            key: "cloudfrontDistributionId",
            value: webAppCloudFrontDistribution.distributionId
        });
        new CfnOutput(this, "backendAPIId", {
            key: 'backendAPIId',
            value: props.backendApiId
          });
        new CfnOutput(this, "backendAPIEndpoint", {
            key: 'backendAPIEndpoint',
            value: props.backendApiEndpoint
        });
        new CfnOutput(this, "cognitoUserPoolId", {
            key: 'cognitoUserPoolId',
            value: props.cognitoUserPoolId
        });
        new CfnOutput(this, "cognitoAppClientId", {
            key: 'cognitoAppClientId',
            value: props.cognitoAppClientId
        });
        new CfnOutput(this, "cognitoDomainName", {
            key: 'cognitoDomainName',
            value: props.cognitoDomainName
        });
    }
}
