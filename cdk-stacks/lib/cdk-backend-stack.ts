import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag'

import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';

import { CognitoStack } from '../lib/infrastructure/cognito-stack';
import { DemoAPIStack } from '../lib/api/demoAPI-stack';
import { DemoDatabaseStack } from './api/demo-table-stack';

export class CdkBackendStack extends cdk.Stack {

  public readonly webAppBucket: s3.IBucket;
  public readonly demoAssetsBucket: s3.IBucket;
  public readonly accessLogsBucket: s3.IBucket;
  public readonly backendApiEndpoint: string;
  public readonly backendApiId: string;
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;
  public readonly domainName: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const appName = 'GenAILabs-Demo'

    // create infrastructure stacks
      // Authentication
    const cognitoStack = new CognitoStack(this, 'CognitoStack', {
      cdkAppName: appName
    });
    this.domainName = cognitoStack.userPoolDomain.domain
    this.userPoolId = cognitoStack.userPool.userPoolId
    this.userPoolClientId = cognitoStack.userPoolClient.userPoolClientId

    // create demo database stack
    const demoDatabaseStack = new DemoDatabaseStack(this, 'DemoDatabaseStack', {
      cdkAppName: appName,
    });

    // create API stack
    const demoAPIStack = new DemoAPIStack(this, 'DemoAPIStack', {
      cdkAppName: appName,
      demoTable: demoDatabaseStack.demoTable,
      cognitoUserPool: cognito.UserPool.fromUserPoolArn(this, 'importedpool', 'arn:aws:cognito-idp:us-east-1:381492099169:userpool/us-east-1_yLe9iu9Il'),
      cognitoUserPoolClient: cognito.UserPoolClient.fromUserPoolClientId(this, 'importedclient', '792tvb07i9g6pks5fr6hincght')
    });
    this.backendApiEndpoint = demoAPIStack.demoAPI.apiEndpoint
    this.backendApiId = demoAPIStack.demoAPI.apiId

    //create log bucket
    const accessLogsBucket = new s3.Bucket(this, "accessLogsBucket", {
      bucketName: `${appName}-AccessLogs-${this.account}-${this.region}`.toLowerCase(),
      removalPolicy: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
    });

    accessLogsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetBucketAcl', 's3:PutObject'],
        principals: [new iam.ServicePrincipal('delivery.logs.amazonaws.com')],
        resources: [
          accessLogsBucket.bucketArn,
          `${accessLogsBucket.bucketArn}/*`,
        ],
      })
    );

    NagSuppressions.addResourceSuppressions(accessLogsBucket, [
      {
        id: 'AwsSolutions-S1',
        reason: 'This is the Log Bucket.'
      },
    ])

    //create webapp bucket
    const webAppBucket = new s3.Bucket(this, "WebAppBucket", {
      bucketName: `${appName}-WebAppBucket-${this.account}-${this.region}`.toLowerCase(),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'demoPlatformWebApp',
    });

    /**************************************************************************************************************
      * CDK Outputs *
    **************************************************************************************************************/

    this.webAppBucket = webAppBucket;
    this.accessLogsBucket = accessLogsBucket;

    new cdk.CfnOutput(this, "webAppBucketName", {
      key: 'webAppBucketName',
      value: webAppBucket.bucketName
    });
    new cdk.CfnOutput(this, "userPoolId", {
      key: 'userPoolId',
      value: this.userPoolId
    });
    new cdk.CfnOutput(this, "demoDatabaseName", {
      key: 'demoDatabaseName',
      value: demoDatabaseStack.demoTable.tableName
    });
    new cdk.CfnOutput(this, "demoDatabaseArn", {
      key: 'demoDatabaseArn',
      value: demoDatabaseStack.demoTable.tableArn
    });
    new cdk.CfnOutput(this, "demoAPIId", {
      key: 'demoAPIId',
      value: demoAPIStack.demoAPI.apiId
    });
    new cdk.CfnOutput(this, "demoAPIEndpoint", {
      key: 'demoAPIEndpoint',
      value: demoAPIStack.demoAPI.apiEndpoint
    });
  }
}

