#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkBackendStack } from '../stacks/cdk-backend-stack';
import { CdkFrontendStack } from '../stacks/cdk-frontend-stack';
import { AwsSolutionsChecks } from 'cdk-nag'
import { Aspects } from 'aws-cdk-lib';

const app = new cdk.App();
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))  //Comment this line to bypass cdk-nag

const application_version = app.node.tryGetContext('application_version')
console.log("VERSION: ", application_version)

// Deploy backend and frontend stacks here
console.log("ACCOUNT: ", process.env.CDK_DEFAULT_ACCOUNT)
console.log("REGION: ", process.env.CDK_DEFAULT_REGION)

const cdkBackendStack = new CdkBackendStack(app, 'GenAILabs-Demo-BackendStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});

const cdkFrontendStack = new CdkFrontendStack(app, 'GenAILabs-Demo-FrontendStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  webAppBucket: cdkBackendStack.webAppBucket,
  accessLogsBucket: cdkBackendStack.accessLogsBucket,
  backendApiEndpoint: cdkBackendStack.backendApiEndpoint,
  backendApiId: cdkBackendStack.backendApiId,
  cognitoDomainName: cdkBackendStack.domainName,
  cognitoAppClientId: cdkBackendStack.userPoolClientId,
  cognitoUserPoolId: cdkBackendStack.userPoolId
});