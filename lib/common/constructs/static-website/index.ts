import { CustomResource, Duration } from "aws-cdk-lib";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import {
    Artifacts,
    BuildSpec,
    ComputeType,
    IBuildImage,
    Project,
    Source,
} from "aws-cdk-lib/aws-codebuild";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import { LogLevel } from "aws-cdk-lib/aws-stepfunctions";
import { Provider } from "aws-cdk-lib/custom-resources";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";
import { CommonNodejsFunction } from "../lambda";

export interface StaticWebsiteBuildProps {
    path: string;
    exclude?: string[];
    destinationBucket: Bucket;
    distribution: Distribution;
    buildImage?: IBuildImage;
    computeType?: ComputeType;
    environmentVariables?: Record<string, string>;
    runtimeVersions: Record<string, string>;
    installCommands?: string[];
    commands: string[];
    primaryOutputDirectory: string;
}

export class StaticWebsiteBuild extends Construct {
    public readonly asset: Asset;
    public readonly project: Project;
    public readonly provider: Provider;
    public readonly customResource: CustomResource;

    constructor(scope: Construct, id: string, props: StaticWebsiteBuildProps) {
        super(scope, id);

        this.asset = new Asset(this, "asset", {
            path: props.path,
            exclude: props.exclude,
        });

        this.project = new Project(this, "project", {
            source: Source.s3({
                bucket: this.asset.bucket,
                path: this.asset.s3ObjectKey,
            }),
            artifacts: Artifacts.s3({
                bucket: props.destinationBucket,
                includeBuildId: false,
                packageZip: false,
                name: "/",
                encryption: false,
            }),
            environment: {
                buildImage: props.buildImage,
                computeType: props.computeType,
                environmentVariables: {
                    ...Object.fromEntries(
                        Object.entries(props.environmentVariables || {}).map(([key, value]) => [
                            key,
                            { value },
                        ])
                    ),
                    DISTRIBUTION_ID: {
                        value: props.distribution.distributionId,
                    },
                },
            },
            buildSpec: BuildSpec.fromObject({
                version: "0.2",
                phases: {
                    install: {
                        "runtime-versions": props.runtimeVersions,
                        ...(props.installCommands && { commands: props.installCommands }),
                    },
                    build: {
                        commands: props.commands,
                    },
                    post_build: {
                        commands: [
                            'aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"',
                        ],
                    },
                },
                artifacts: {
                    files: ["**/*"],
                    "base-directory": props.primaryOutputDirectory,
                },
            }),
        });
        this.project.addToRolePolicy(
            new PolicyStatement({
                actions: ["cloudfront:CreateInvalidation"],
                resources: [props.distribution.distributionArn],
            })
        );
        NagSuppressions.addResourceSuppressions(this.project, [
            {
                id: "AwsSolutions-CB4",
                reason: "CodeBuild project does not need a KMS key for encryption.",
            },
        ]);

        const entry = path.join(__dirname, "provider.ts");
        this.provider = new Provider(this, "provider", {
            onEventHandler: new CommonNodejsFunction(this, "onEventHandler", {
                entry,
                handler: "onEventHandler",
                initialPolicy: [
                    new PolicyStatement({
                        actions: ["codebuild:StartBuild"],
                        resources: [this.project.projectArn],
                    }),
                ],
            }),
            isCompleteHandler: new CommonNodejsFunction(this, "isCompleteHandler", {
                entry,
                handler: "isCompleteHandler",
                initialPolicy: [
                    new PolicyStatement({
                        actions: ["codebuild:BatchGetBuilds"],
                        resources: [this.project.projectArn],
                    }),
                ],
            }),
            queryInterval: Duration.seconds(15),
            totalTimeout: Duration.minutes(15),
            waiterStateMachineLogOptions: {
                level: LogLevel.ALL,
            },
        });
        NagSuppressions.addResourceSuppressions(
            this.provider,
            [
                {
                    id: "AwsSolutions-SF2",
                    reason: "X-Ray tracing is not configurable.",
                },
                {
                    id: "AwsSolutions-SF1",
                    reason: "Step Function does log all events.",
                },
            ],
            true
        );

        this.customResource = new CustomResource(this, "customResource", {
            serviceToken: this.provider.serviceToken,
            properties: {
                projectName: this.project.projectName,
                assetHash: this.asset.assetHash,
            },
        });
    }
}
