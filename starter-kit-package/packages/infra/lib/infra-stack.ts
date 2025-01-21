import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CDKProps } from "../config/AppConfig";
import { NagSuppressions } from "cdk-nag";
import { VpcStack } from "../stacks/vpc-stack";
import { WAFStack } from "../stacks/waf-stack";
import { WebsiteWAFStack } from "../stacks/website-waf-stack";
import { AuthStack } from "../stacks/auth-stack";
import { resolve } from 'path';

import { BucketStack } from "../stacks/bucket-stack";
import { PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";
import { HttpApiGatewayStack } from "../stacks/http-api-gateway-stack";
import { RestApiGatewayStack } from "../stacks/rest-api-gateway-stack";
import { GraphQlApiStack } from "../stacks/graphql-api-stack";
import { getProjectConfig } from "../tools/kyber-cli/utils";


export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CDKProps) {
    super(scope, id, props);
    const projectConfigPath = resolve(__dirname, '..', 'config', 'project-config.json');
    const projectConfigJson = getProjectConfig(projectConfigPath)
    if (!projectConfigJson) {
      console.error(`\n 🛑 Project config not found. \n`);
      return
    }
    const account = projectConfigJson.account[props.accountName];
    /**
     * VPC Stack
    */
    const vpcStack = new VpcStack(this, "vpc-stack", props)
    cdk.Tags.of(vpcStack).add("project", props.projectName)

    /**
       * Web application Firewall stack 
       */
    const wafStack = new WAFStack(this, "waf-stack", props)
    cdk.Tags.of(wafStack).add("project", props.projectName)

    /**
        * Website stack to host the static website
        * with Amazon cloudfront, AWS S3 buckets with access logs 
        */

    const websiteWafStack = new WebsiteWAFStack(this, "website-waf-stack", props);
    cdk.Tags.of(websiteWafStack).add("project", props.projectName)

    NagSuppressions.addStackSuppressions(websiteWafStack, [{
      id: "AwsSolutions-IAM4",
      reason: "Custom WAF resource overrides to create in us-east-1",
    },
    {
      id: "AwsSolutions-L1",
      reason: "regional WAF CDK construct is inherently using an older version. Will update the construct when a new version becomes available.",
    },])

    /**
         * Auth Stack
    */

    const authStack = new AuthStack(this, "auth-stack", {
      ...props,
      regionalWebAclArn: wafStack.regionalWebAcl.attrArn,
      distributionDomainName: websiteWafStack.cloudfrontDistribution.distributionDomainName,
      midwaySecretID: account?.midwaySecretID ?? undefined

    })
    cdk.Tags.of(authStack).add("project", props.projectName)
    authStack.addDependency(wafStack)
    authStack.addDependency(websiteWafStack)


    /**
        * Bucket Stack 
        */
    const dataBucketStack = new BucketStack(this, "data-bucket-stack", {
      ...props,
      distributionDomainName: websiteWafStack.cloudfrontDistribution.distributionDomainName,
      projectAccessLogsBucket: websiteWafStack.projectAccessLogsBucket,
      kmsKey: websiteWafStack.kmsKey
    })
    cdk.Tags.of(dataBucketStack).add("project", props.projectName)
    dataBucketStack.addDependency(websiteWafStack)

    // allow cognito auth role to access content bucket
    authStack.authenticatedRole.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "s3:ListBucket",
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ],
        resources: [
          dataBucketStack.dataBucket.bucketArn,
          `${dataBucketStack.dataBucket.bucketArn}/*`,
        ], //restrict R/W objects for data bucket only in the same account under the prefix of this project name
        // 
      })
    );

    // allow cognito auth role to access decrypt data bucket
    authStack.authenticatedRole.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["kms:Decrypt"],
        resources: [websiteWafStack.kmsKey.keyArn]
      }))

    NagSuppressions.addStackSuppressions(authStack, [{
      id: "AwsSolutions-IAM5",
      reason: "allow wild card in data bucket access to allow access to future prefixes",
    }])

    /**
       * Http API Gateway Stack
       */
    const httpApiGatewayStack = new HttpApiGatewayStack(this, "api-gateway-stack", {
      ...props,
      userPool: authStack.userPool,
      userPoolClient: authStack.userPoolClient,
      distributionDomainName: websiteWafStack.cloudfrontDistribution.distributionDomainName,
      vpc: vpcStack.vpc,
      defaultSecurityGroup: vpcStack.defaultSecurityGroup

    })
    cdk.Tags.of(httpApiGatewayStack).add("project", props.projectName)

    httpApiGatewayStack.addDependency(authStack)
    httpApiGatewayStack.addDependency(websiteWafStack)


    /**
      * Rest API Gateway Stack
      */

    const restAPIGatewayStack = new RestApiGatewayStack(this, "rest-api-gateway-stack", {
      ...props,
      userPoolARN: authStack.userPool.userPoolArn,
      distributionDomainName: websiteWafStack.cloudfrontDistribution.distributionDomainName,
      regionalWebAclArn: wafStack.regionalWebAcl.attrArn,
      vpc: vpcStack.vpc,
      defaultSecurityGroup: vpcStack.defaultSecurityGroup
    })
    cdk.Tags.of(restAPIGatewayStack).add("project", props.projectName)

    restAPIGatewayStack.addDependency(authStack)
    restAPIGatewayStack.addDependency(websiteWafStack)
    restAPIGatewayStack.addDependency(wafStack)

    NagSuppressions.addStackSuppressions(restAPIGatewayStack, [{
      id: "AwsSolutions-IAM4",
      reason: "Using default role for demo purposes. This lambda must use a specific role tailored to its function",
    }])

    /**
      * GraphQL API Gateway Stack
    */

    const graphqlAPIStack = new GraphQlApiStack(this, "graphql-api-stack", {
      ...props,
      userPool: authStack.userPool,
      distributionDomainName: websiteWafStack.cloudfrontDistribution.distributionDomainName,
      regionalWebAclArn: wafStack.regionalWebAcl.attrArn,
      vpc: vpcStack.vpc,
      defaultSecurityGroup: vpcStack.defaultSecurityGroup
    })

    cdk.Tags.of(graphqlAPIStack).add("project", props.projectName)
    // allow lambda function to read & write to data bucket
    dataBucketStack.dataBucket.grantReadWrite(graphqlAPIStack.resolverLambda)

    NagSuppressions.addStackSuppressions(graphqlAPIStack, [{
      id: "AwsSolutions-IAM4",
      reason: "Using managed policies for wider access to VPC for resolver lambda",
    },
    {
      id: "AwsSolutions-IAM5",
      reason: "GraphQL Constructs has the wild cards to accommodate future tables and configurations.",
    },
    {
      id: "AwsSolutions-S1",
      reason: "GraphQL Construct has S3 bucket logs disabled as a default setting. Not overriding as this is a construct to manage Appsync with Dynamo DB  ",
    },
    {
      id: "AwsSolutions-S10",
      reason: "GraphQL Construct has S3 bucket policy to not require requests to use SSL default setting. Not overriding as this is a construct to manage Appsync with Dynamo DB",
    },
    {
      id: "AwsSolutions-L1",
      reason: "Appsync Alpha GraphQL CDK Construct has a default runtime for resolver lambdas. This is a library and the runtime cannot be overridden. ",
    },
    ])

  }
}
