import { CloudfrontWebAcl } from "@aws/pdk/static-website";
import { Aspects, CfnOutput, StackProps } from "aws-cdk-lib";
import {
    AllowedMethods,
    Distribution,
    OriginRequestPolicy,
    SecurityPolicyProtocol,
    SSLMethod,
    ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { ComputeType, LinuxArmBuildImage } from "aws-cdk-lib/aws-codebuild";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";
import { FunctionRuntimeAspect } from "../../common/aspects";
import { CommonBucket } from "../../common/constructs/s3";
import { CommonStack } from "../../common/constructs/stack";
import { StaticWebsiteBuild } from "../../common/constructs/static-website";

export class Frontend extends CommonStack {
    public readonly websiteBucket: Bucket;
    public readonly distribution: Distribution;
    public readonly urls: string[];

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const loggingBucket = new CommonBucket(this, "loggingBucket", {});

        const websiteBucket = new CommonBucket(this, "websiteBucket", {
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
        Aspects.of(cloudfrontWebAcl).add(new FunctionRuntimeAspect());

        const distribution = new Distribution(this, "distribution", {
            defaultRootObject: "index.html",
            defaultBehavior: {
                origin: S3BucketOrigin.withOriginAccessControl(websiteBucket),
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: AllowedMethods.ALLOW_ALL,
                originRequestPolicy: OriginRequestPolicy.CORS_S3_ORIGIN,
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
            minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
            sslSupportMethod: SSLMethod.SNI,
            webAclId: cloudfrontWebAcl.webAclArn,
            logBucket: loggingBucket,
            logIncludesCookies: true,
            logFilePrefix: "distribution",
        });
        NagSuppressions.addResourceSuppressions(distribution, [
            {
                id: "AwsSolutions-CFR1",
                reason: "Distribution should be globally accessible.",
            },
            {
                id: "AwsSolutions-CFR4",
                reason: "Distribution is configured with TLS_V1_2_2021.",
            },
        ]);

        new CfnOutput(this, "url", {
            value: distribution.distributionDomainName,
            description: "CloudFront URL",
        });

        this.websiteBucket = websiteBucket;
        this.distribution = distribution;
        this.urls = [`https://${distribution.distributionDomainName}`, "http://localhost:3000"];
    }
}

interface FrontendDeploymentProps extends StackProps {
    websiteBucket: Bucket;
    distribution: Distribution;
    environmentVariables: Record<string, string>;
}

export class FrontendDeployment extends CommonStack {
    constructor(scope: Construct, id: string, props: FrontendDeploymentProps) {
        super(scope, id, props);

        const { websiteBucket, distribution, environmentVariables } = props;

        new StaticWebsiteBuild(this, "staticWebsiteBuild", {
            path: path.join(__dirname, "app"),
            exclude: ["node_modules", "dist"],
            destinationBucket: websiteBucket,
            distribution,
            buildImage: LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
            computeType: ComputeType.SMALL,
            environmentVariables,
            runtimeVersions: {
                nodejs: "22",
            },
            installCommands: ["npm install"],
            commands: ["npm run build"],
            primaryOutputDirectory: "dist",
        });

        new CfnOutput(this, "environmentVariables", {
            value: JSON.stringify(environmentVariables),
        });
    }
}
