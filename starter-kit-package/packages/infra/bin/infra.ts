#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagPackSuppression, NagSuppressions } from "cdk-nag";
import { getProjectConfig } from "../tools/kyber-cli/utils";
import { resolve } from 'path';

import { InfraStack } from "../lib/infra-stack";
import { PipelineStack } from "../lib/pipeline-stack";
import { PresetStageType } from "../shared";
const projectConfigPath = resolve(__dirname, '..', 'config', 'project-config.json');
const app = new cdk.App();

// get command line params for account stage/ sandbox alias identifier otherwise default to dev 
const accountName: string = app.node.tryGetContext("accountName") ?? PresetStageType.Dev
accountName.trim()
// get project config 
const projectConfigJson = getProjectConfig(projectConfigPath)
if (!projectConfigJson) {
  console.error(`\n 🛑 Project config not found. \n`);
  throw new Error("Project config not found")
}
const account = projectConfigJson.account[accountName];
if (!account) {
  console.log("Account not found in Account Mappings")
  throw new Error("Account not found in Account Mappings")
}


const StackSuppressions: NagPackSuppression[] = [{
  id: "AwsSolutions-IAM5",
  reason: "Wild card in read only role as we block all other S3 operations than read. ",
},
{
  id: "AwsSolutions-S1",
  reason: "CloudTrail S3 resource doesn't need access logs.",
},
{
  id: "AwsSolutions-CB4",
  reason: "Disabling KMS usage for CodeBuild for as these are demos.",
},
{
  id: "AwsSolutions-KMS5",
  reason: "Key rotation disabled for codepipeline.",
},
]

if (projectConfigJson.codePipeline && (accountName === PresetStageType.Dev || accountName === PresetStageType.Prod)) {
  const pipelineStack = new PipelineStack(app, `${projectConfigJson.projectName}`, {
    projectName: projectConfigJson.projectName,
    accountName,
    /* If you don't specify 'env', this stack will be environment-agnostic.
     * Account/Region-dependent features and context lookups will not work,
     * but a single synthesized template can be deployed anywhere. */

    /* Uncomment the next line to specialize this stack for the AWS Account
     * and Region that are implied by the current CLI configuration. */
    env: { account: account.number, region: account.region },

    /* Uncomment the next line if you know exactly what Account and Region you
     * want to deploy the stack to. */
    // env: { account: '123456789012', region: 'us-east-1' },

    /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */

  })
  cdk.Tags.of(pipelineStack).add("project", projectConfigJson.projectName)

  // Add CDK Nag for infra security
  cdk.Aspects.of(app).add(new AwsSolutionsChecks());

  /**
   * App wide NAG suppressions
   * Some of the resources used with in CDK constructs req
   */
  NagSuppressions.addStackSuppressions(pipelineStack, StackSuppressions)

} else {
  const infraStack = new InfraStack(app, `${projectConfigJson.projectName}`, {
    projectName: projectConfigJson.projectName,
    accountName,
    /* If you don't specify 'env', this stack will be environment-agnostic.
     * Account/Region-dependent features and context lookups will not work,
     * but a single synthesized template can be deployed anywhere. */

    /* Uncomment the next line to specialize this stack for the AWS Account
     * and Region that are implied by the current CLI configuration. */
    env: { account: account.number, region: account.region },

    /* Uncomment the next line if you know exactly what Account and Region you
     * want to deploy the stack to. */
    // env: { account: '123456789012', region: 'us-east-1' },

    /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */

  });
  cdk.Tags.of(infraStack).add("project", projectConfigJson.projectName)

  // Add CDK Nag for infra security
  cdk.Aspects.of(app).add(new AwsSolutionsChecks());

  /**
   * App wide NAG suppressions
   * Some of the resources used with in CDK constructs req
   */
  NagSuppressions.addStackSuppressions(infraStack, StackSuppressions)

  // synthesize the CDK package 
  app.synth();

}