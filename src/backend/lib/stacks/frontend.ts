import { StartBuildCommandInput } from "@aws-sdk/client-codebuild";
import { CloudfrontWebAcl } from "@aws/pdk/static-website";
import {
    CfnOutput,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as cloudfront_origins,
    aws_codebuild as codebuild,
    custom_resources,
    aws_iam as iam,
    aws_s3 as s3,
    aws_s3_assets as s3_assets,
    Stack,
    StackProps,
} from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";
import { LabsReactProject } from "../common/constructs/codebuild";
import { LabsBucket } from "../common/constructs/s3";
import { LabsStack } from "../common/constructs/stack";

export class FrontendStack extends LabsStack {
    public readonly websiteBucket: s3.Bucket;
    public readonly distribution: cloudfront.Distribution;
    public readonly urls: string[];

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const loggingBucket = new LabsBucket(this, "loggingBucket", {});

        this.websiteBucket = new LabsBucket(this, "websiteBucket", {
            serverAccessLogsBucket: loggingBucket,
        });

        const cloudfrontWebAcl = new CloudfrontWebAcl(this, "cloudfrontWebAcl", {
            managedRules: [
                {
                    vendor: "AWS",
                    name: "AWSManagedRulesCommonRuleSet",
                },
                {
                    vendor: "AWS",
                    name: "AWSManagedRulesAmazonIpReputationList",
                },
                {
                    vendor: "AWS",
                    name: "AWSManagedRulesBotControlRuleSet",
                },
            ],
        });

        this.distribution = new cloudfront.Distribution(this, "distribution", {
            defaultRootObject: "index.html",
            defaultBehavior: {
                origin: cloudfront_origins.S3BucketOrigin.withOriginAccessControl(
                    this.websiteBucket
                ),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
            },
            errorResponses: [
                {
                    httpStatus: 404,
                    responsePagePath: "/index.html",
                    responseHttpStatus: 200,
                },
                {
                    httpStatus: 403,
                    responsePagePath: "/index.html",
                    responseHttpStatus: 200,
                },
            ],
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            sslSupportMethod: cloudfront.SSLMethod.SNI,
            webAclId: cloudfrontWebAcl.webAclArn,
            logBucket: loggingBucket,
            logIncludesCookies: true,
            logFilePrefix: "distribution",
        });
        NagSuppressions.addResourceSuppressions(this.distribution, [
            {
                id: "AwsSolutions-CFR1",
                reason: "Distribution should be globally accessible.",
            },
            {
                id: "AwsSolutions-CFR4",
                reason: "Distribution is configured with TLS_V1_2_2021.",
            },
        ]);

        this.urls = [
            `https://${this.distribution.distributionDomainName}`,
            "http://localhost:3000",
        ];
    }
}

export interface FrontendDeployStackProps extends StackProps {
    websiteBucket: s3.Bucket;
    distribution: cloudfront.Distribution;
    environmentVariables: Record<string, string>;
}

export class FrontendDeployStack extends LabsStack {
    constructor(scope: Construct, id: string, props: FrontendDeployStackProps) {
        super(scope, id, props);

        const websiteAssets = new s3_assets.Asset(this, "websiteAssets", {
            path: path.join(__dirname, "..", "..", "..", "frontend"),
            exclude: ["node_modules", "dist"],
        });

        const buildEnvironmentVariables: codebuild.BuildEnvironment["environmentVariables"] =
            Object.fromEntries(
                Object.entries(props.environmentVariables).map(([key, value]) => [key, { value }])
            );

        const project = new LabsReactProject(this, "reactProject", {
            source: codebuild.Source.s3({
                bucket: websiteAssets.bucket,
                path: websiteAssets.s3ObjectKey,
            }),
            artifacts: codebuild.Artifacts.s3({
                bucket: props.websiteBucket,
                includeBuildId: false,
                packageZip: false,
                name: "/",
                encryption: false,
            }),
            environment: {
                buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
                computeType: codebuild.ComputeType.SMALL,
                environmentVariables: {
                    ...buildEnvironmentVariables,
                    DISTRIBUTION_ID: {
                        value: props.distribution.distributionId,
                    },
                },
            },
            buildSpec: codebuild.BuildSpec.fromObject({
                version: "0.2",
                phases: {
                    install: {
                        runtimeVersions: {
                            nodejs: "22",
                        },
                        commands: ["npm install"],
                    },
                    build: {
                        commands: ["npm run build"],
                    },
                    post_build: {
                        commands: [
                            'aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"',
                        ],
                    },
                },
                artifacts: {
                    files: ["**/*"],
                    "base-directory": "dist",
                },
            }),
        });
        project.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ["cloudfront:CreateInvalidation"],
                resources: [props.distribution.distributionArn],
            })
        );
        NagSuppressions.addResourceSuppressions(project, [
            {
                id: "AwsSolutions-CB4",
                reason: "CodeBuild project does not need a KMS key for encryption.",
            },
        ]);

        const startBuildCall: custom_resources.AwsSdkCall = {
            service: "CodeBuild",
            action: "startBuild",
            parameters: {
                projectName: project.projectName,
            } as StartBuildCommandInput,
            physicalResourceId: custom_resources.PhysicalResourceId.of(websiteAssets.assetHash),
            outputPaths: ["build.id", "build.buildNumber"],
        };
        new custom_resources.AwsCustomResource(this, "buildCustomResource", {
            onCreate: startBuildCall,
            onUpdate: startBuildCall,
            policy: custom_resources.AwsCustomResourcePolicy.fromSdkCalls({
                resources: [project.projectArn],
            }),
        });

        const outputPrefix = Stack.of(this).stackName;
        Object.entries(props.environmentVariables).forEach(([key, value]) => {
            const outputKey = key.toLocaleLowerCase();
            const outputId = outputKey.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
            const outputSuffix = outputKey.replace(/_/g, "-");
            new CfnOutput(this, outputId, {
                value: value,
                exportName: `${outputPrefix}-${outputSuffix}`,
            });
        });
    }
}
