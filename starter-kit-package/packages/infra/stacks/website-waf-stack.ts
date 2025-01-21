import { CfnOutput, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { AllowedMethods, CachePolicy, Distribution, OriginAccessIdentity, OriginRequestPolicy, SecurityPolicyProtocol, SSLMethod, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { WebAcl } from "../constructs/cloudfront-waf";
import { NagSuppressions } from "cdk-nag";
import { setSecureTransport } from "../constructs/cdk-helpers";
import { CDKProps } from "../config/AppConfig";
import { Key } from "aws-cdk-lib/aws-kms";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { AccountPrincipal, CompositePrincipal, Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { PresetStageType } from "../shared";
import { resolve } from 'path';
import { getProjectConfig } from "../tools/kyber-cli/utils";

export class WebsiteWAFStack extends Stack {
    public readonly cloudfrontDistribution: Distribution
    public readonly kmsKey: Key;
    public readonly projectAccessLogsBucket: Bucket;
    constructor(scope: Construct, id: string, props: CDKProps) {
        super(scope, id, props);
        const projectConfigPath = resolve(__dirname, '..', 'config', 'project-config.json');
        const projectConfigJson = getProjectConfig(projectConfigPath)
        if (!projectConfigJson) {
            console.error(`\n 🛑 Project config not found. \n`);
            return
        }
        this.kmsKey = new Key(this, `${props.projectName}-key`, {
            removalPolicy: RemovalPolicy.DESTROY,
            pendingWindow: Duration.days(7),
            alias: `${props.projectName}-key-alias`,
            description: 'KMS key for encrypting the objects in S3 bucket for this project',
            enableKeyRotation: true,
            rotationPeriod: Duration.days(365), // this can be altered
        });

        // Access logs bucket for project wide buckets
        this.projectAccessLogsBucket = new Bucket(
            this,
            "website-access-log-bucket",
            {
                bucketName: `${props.projectName}-website-log-${this.account}-${this.region}`,
                versioned: true,
                publicReadAccess: false,
                encryption: BucketEncryption.KMS,
                encryptionKey: this.kmsKey,
                enforceSSL: true,
                objectOwnership: ObjectOwnership.OBJECT_WRITER,
                autoDeleteObjects: true,
                blockPublicAccess: {
                    blockPublicAcls: true,
                    blockPublicPolicy: true,
                    ignorePublicAcls: true,
                    restrictPublicBuckets: true,
                },
                removalPolicy: RemovalPolicy.DESTROY,
                serverAccessLogsPrefix: "access-log",
            }
        );
        setSecureTransport(this.projectAccessLogsBucket);

        const websiteBucket = new Bucket(this, "website-bucket", {
            bucketName: `${props.projectName}-website-${this.account}-${this.region}`,
            publicReadAccess: false,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            encryptionKey: this.kmsKey,
            enforceSSL: true,
            removalPolicy: RemovalPolicy.DESTROY,
            serverAccessLogsPrefix: "website-bucket",
            serverAccessLogsBucket: this.projectAccessLogsBucket,
        });

        setSecureTransport(websiteBucket);

        // Cloudfront distribution
        const originAccessIdentity = new OriginAccessIdentity(
            this,
            "cloudfront-oai",
        );
        websiteBucket.grantRead(originAccessIdentity);


        // CloudFront Web ACL
        const webAcl = new WebAcl(this, "web-acl", {
            scope: "CLOUDFRONT",
            region: "us-east-1", // must be in us-east-1; optional cdk bootstrapping required in us-east-1,
            account: this.account,
        });

        NagSuppressions.addResourceSuppressions(
            webAcl,
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "Custom WAF resource overrides to create in us-east-1",
                },
            ],
            true
        );


        this.cloudfrontDistribution = new Distribution(
            this,
            `${props.projectName}-cloudfront-distribution`,
            {

                webAclId: webAcl.webAclArn,
                enableLogging: true,
                logBucket: this.projectAccessLogsBucket, // Specify the log bucket
                defaultRootObject: "index.html",
                minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
                sslSupportMethod: SSLMethod.SNI,
                defaultBehavior: {
                    origin: S3BucketOrigin.withOriginAccessControl(websiteBucket, {
                        originAccessControlId: originAccessIdentity.originAccessIdentityId,
                    }),
                    compress: true,
                    cachePolicy: CachePolicy.CACHING_OPTIMIZED,
                    allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    originRequestPolicy: OriginRequestPolicy.CORS_S3_ORIGIN,
                },
                errorResponses: [
                    {
                        httpStatus: 403,
                        responseHttpStatus: 200,
                        responsePagePath: '/index.html',
                        ttl: Duration.minutes(30),
                    }
                ],
            }
        );

        // role to assume for web deployment 
        const devAccount = projectConfigJson.account[PresetStageType.Dev];
        if (!devAccount) {
            throw new Error("Dev account configuration not found")
        }

        const deployWebsiteRole = new Role(this, `${props.projectName}-deploy-website-role`, {
            roleName: `${props.projectName}-deploy-website`,
            description: "A cross account role to be assumed by codebuild in Dev account to deploy website in prod account to list CF exports to generate env variables and deploy website",
            // allow only DEV account to assume this from codebuild
            assumedBy: new CompositePrincipal(
                new AccountPrincipal(devAccount.number),
                new ServicePrincipal("codebuild.amazonaws.com")
            ),
            inlinePolicies: {
                "ListExportsPolicy": new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ["cloudformation:GetTemplateSummary", "cloudformation:ListExports",
                            ],
                            resources: ["*"] // must have * permission to list all stacks in account to filter the correct stack
                        }),
                    ],
                }),
                "WebsiteBucketWrite": new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ["s3:*Object", "s3:List*"],
                            resources: [websiteBucket.bucketArn, `${websiteBucket.bucketArn}/*`],
                        }),
                    ],
                }),
                "DatBucketWrite": new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ["s3:*Object", "s3:List*"],
                            resources: [`arn:aws:s3:::${props.projectName}-data-bucket-${this.account}-${this.region}`, `arn:aws:s3:::${props.projectName}-data-bucket-${this.account}-${this.region}/*`],
                        }),
                    ],
                }),
                "DecryptKM": new PolicyDocument({
                    statements: [

                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ["kms:GenerateDataKey*", "kms:Decrypt"],
                            resources: [this.kmsKey.keyArn],
                        }),
                    ],
                }),
                "CFInvalidation": new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ["cloudfront:CreateInvalidation"],
                            resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
                        }),
                    ],
                })
            }
        });

        NagSuppressions.addResourceSuppressions(
            deployWebsiteRole,
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "Must use * for listing all stacks in the target account",
                },
            ],
            true
        );
        // export website deploy role name
        new CfnOutput(this, "config-website-deployment-role-name", {
            value: deployWebsiteRole.roleName,
            exportName: `${props.projectName}-config-website-deployment-role-name`,
        });
        new CfnOutput(this, "config-website-deployment-role-arn", {
            value: deployWebsiteRole.roleArn,
            exportName: `${props.projectName}-config-website-deployment-role-arn`,
        });


        // export website bucket name 
        new CfnOutput(this, "config-website-s3-bucket-name", {
            value: "s3://" + websiteBucket.bucketName,
            exportName: `${props.projectName}-config-website-s3-bucket-name`,
        });

        // export cloudfront distribution name 
        new CfnOutput(this, "config-website-distribution-id", {
            value: this.cloudfrontDistribution.distributionId,
            exportName: `${props.projectName}-config-website-distribution-id`,
        });

        // export cloudfront distribution endpoint 
        new CfnOutput(this, "config-website-distribution-domain", {
            value: `https://${this.cloudfrontDistribution.distributionDomainName}`,
            exportName: `${props.projectName}-config-website-distribution-domain`,
        });



        NagSuppressions.addResourceSuppressions(
            this.cloudfrontDistribution,
            [
                {
                    id: "AwsSolutions-CFR4",
                    reason: "using the default certificate to speed up development",
                },
                {
                    id: "AwsSolutions-CFR5",
                    reason: "using the default certificate to speed up development",
                },
            ],
            true
        );
    }
}