import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as pipelines from "aws-cdk-lib/pipelines";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as cloudtrail from "aws-cdk-lib/aws-cloudtrail";
import * as codePipeline from "aws-cdk-lib/aws-codepipeline";
import * as codePipelinesActions from "aws-cdk-lib/aws-codepipeline-actions";
import * as kms from "aws-cdk-lib/aws-kms";
import { resolve } from 'path';
// local imports
import { setSecureTransport } from "../constructs/cdk-helpers";
import { DeployStage } from "./deploy-stage";
import { CDKProps } from "../config/AppConfig";
import { getProjectConfig } from "../tools/kyber-cli/utils";
import { PresetStageType } from "../shared";
import { BuildSpec } from "aws-cdk-lib/aws-codebuild";


export class PipelineStack extends cdk.Stack {
    public readonly codeBucket: s3.Bucket;
    public deploymentPipeline: pipelines.CodePipeline;
    public readonly kmsPipelineKey: kms.Key;
    public readonly sourceAccessLogsBucket: s3.Bucket;
    constructor(scope: Construct, id: string, props: CDKProps) {
        super(scope, id, props);
        const objectKey: string = "deploy.zip"; // this is the file name Gitlab-CI will bundle the repo to in AWS S3
        const projectConfigPath = resolve(__dirname, '..', 'config', 'project-config.json')
        const projectConfigJson = getProjectConfig(projectConfigPath)
        if (!projectConfigJson) {
            console.error(`\n 🛑 Project config not found. \n`);
            return
        }

        this.kmsPipelineKey = new kms.Key(this, `${props.projectName}-pipeline-key`, {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            pendingWindow: cdk.Duration.days(7),
            alias: `${props.projectName}-pipeline-key-alias`,
            description: 'KMS key for encrypting the objects in S3 code bucket for this project',
            enableKeyRotation: true,
            rotationPeriod: cdk.Duration.days(365), // this can be altered
        });
        // create an AWS S3 bucket with versioning & access log bucket
        this.sourceAccessLogsBucket = new s3.Bucket(
            this,
            "code-bucket-access-logs",
            {
                bucketName: `${props.projectName}-code-access-logs-${this.account}-${this.account}`,
                objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
                autoDeleteObjects: true,
                encryption: s3.BucketEncryption.KMS,
                encryptionKey: this.kmsPipelineKey,
                bucketKeyEnabled: true,
                blockPublicAccess: {
                    blockPublicAcls: true,
                    blockPublicPolicy: true,
                    ignorePublicAcls: true,
                    restrictPublicBuckets: true,
                },
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                serverAccessLogsPrefix: "access-logs-bucket",
                enforceSSL: true,

            }
        );
        setSecureTransport(this.sourceAccessLogsBucket);

        this.codeBucket = new s3.Bucket(this, "source-bucket", {
            bucketName: `${props.projectName}-source-bucket-${this.account}-${this.region}`,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.S3_MANAGED,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            serverAccessLogsBucket: this.sourceAccessLogsBucket,
            serverAccessLogsPrefix: "code-bucket",
            enforceSSL: true,
            versioned: true // a requirement for triggering AWS CodePipeline Pipeline
        });
        setSecureTransport(this.codeBucket);

        // we specifically use the CfnRole L3 construct because we need to add 2 actions for the trusted principal 
        // as of now the iam.Role construct will by default add only the sts:AssumeRole action 
        // but AWS Credential Vendor requires both sts:AssumeRole" and  "sts:TagSession" actions 
        // https://gitlab.pages.aws.dev/docs/Platform/aws-credential-vendor.html#template-trust-policy
        new iam.CfnRole(this, "gitlab-runner-role", {
            roleName: `${props.projectName}-gitlab-runner-role`,
            assumeRolePolicyDocument: new iam.PolicyDocument({
                statements: [
                    new iam.PolicyStatement({
                        effect: iam.Effect.ALLOW,
                        actions: ["sts:AssumeRole", "sts:TagSession"],
                        principals: [new iam.ArnPrincipal("arn:aws:iam::979517299116:role/gitlab-runners-prod")],  // must be the central Gitlab runner account
                        conditions: {
                            "StringEquals": {
                                "aws:PrincipalTag/GitLab:Group": [projectConfigJson.gitlabGroup],
                                "aws:PrincipalTag/GitLab:Project": [projectConfigJson.gitlabProject]
                            }
                        }
                    }),
                ]
            }),
            policies: [{
                policyName: "CodeBucketReadWritePolicy",
                policyDocument: {
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Sid": "ListObjectsInBucket",
                            "Effect": "Allow",
                            "Action": ["s3:List*"],
                            "Resource": [`${this.codeBucket.bucketArn}`, `${this.codeBucket.bucketArn}/*`]
                        },
                        {
                            "Sid": "AllObjectActions",
                            "Effect": "Allow",
                            "Action": "s3:*Object",
                            "Resource": [`${this.codeBucket.bucketArn}`, `${this.codeBucket.bucketArn}/*`]
                        },
                        {
                            "Sid": "KMS",
                            "Effect": "Allow",
                            "Action": ["kms:GenerateDataKey*", "kms:Decrypt"],
                            "Resource": `${this.kmsPipelineKey.keyArn}`
                        }
                    ]
                }
            }]
        })

        // trail to notify pipeline that a new object is ready in code bucket to start the pipeline
        const trail = new cloudtrail.Trail(this, "cloud-trail");
        trail.addS3EventSelector([{
            bucket: this.codeBucket,
            objectPrefix: objectKey,
        }], {
            readWriteType: cloudtrail.ReadWriteType.WRITE_ONLY,
        });

        // need this source action to trigger CodePipeline
        new codePipelinesActions.S3SourceAction({
            actionName: 'S3Source',
            bucketKey: objectKey,
            bucket: this.codeBucket,
            output: new codePipeline.Artifact(),
            trigger: codePipelinesActions.S3Trigger.EVENTS, // default: S3Trigger.POLL
        });


        const codeArtifactStatements = [
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["codeartifact:GetAuthorizationToken",
                    "codeartifact:GetRepositoryEndpoint",
                    "codeartifact:ReadFromRepository"],
                resources: ["*"] // must have * permission to list all stacks in account to filter the correct stack
            }),
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["sts:GetServiceBearerToken"],
                resources: ["*"], // must have * permission to list all stacks in account to filter the correct stack,
                conditions: {
                    "StringEquals": {
                        "sts:AWSServiceName": "codeartifact.amazonaws.com"
                    }
                }
            }),
        ]

        const nodeModulesInstallCommands = ["npm install"]
        // add a first element to array based on projectConfig.codeArtifact condition
        if (projectConfigJson.codeArtifact) {
            nodeModulesInstallCommands.unshift("aws codeartifact login --tool npm --repository shared --domain amazon --domain-owner 149122183214 --region $AWS_REGION")
        }

        // create a codepipeline with s3 as source
        this.deploymentPipeline = new pipelines.CodePipeline(this, "code-pipeline", {
            pipelineName: `${props?.projectName}-code-pipeline`,
            selfMutation: true, // disable self mutation as the pipeline itself was deployed through another CDK project 
            dockerEnabledForSynth: true, // for bundling code in Docker-in-docker modes
            crossAccountKeys: true, // to deploy the app from dev to prod account
            codeBuildDefaults: {
                buildEnvironment: {
                    buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3,
                    computeType: codebuild.ComputeType.LARGE,
                    privileged: true, // for docker in docker 
                },
                partialBuildSpec: BuildSpec.fromObject({
                    phases: {
                        install: {
                            "runtime-versions": {
                                "nodejs": 22
                            }
                        }
                    }
                })
            },
            synth: new pipelines.CodeBuildStep('Synth', {
                input: pipelines.CodePipelineSource.s3(this.codeBucket, objectKey, {
                    trigger: codePipelinesActions.S3Trigger.EVENTS, // default: S3Trigger.POLL
                    actionName: "S3Source", // this should match above
                }), // this is the file name Gitlab-CI will bundle the repo to in AWS S3
                installCommands: nodeModulesInstallCommands,
                commands: ["npm run -w infra synth"],
                // the directory where the synthesized CDK code will be stored
                primaryOutputDirectory: './packages/infra/cdk.out',
                role: new iam.Role(this, "SynthRole", {
                    description: "Codebuild synth role to authenticate with CodeArtifact & build the CDK infra project ",
                    assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
                    inlinePolicies: {
                        "CodeArtifactPolicy": new iam.PolicyDocument({
                            statements: codeArtifactStatements
                        })
                    }
                }),
            }),
        })

        const deployWebsiteStep = (stageName: PresetStageType) => new pipelines.CodeBuildStep(`Deploy-Website-${stageName}`, {
            buildEnvironment: {
                buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3,
                computeType: codebuild.ComputeType.SMALL,

                // privileged: true, // for docker in docker 
            },
            partialBuildSpec: BuildSpec.fromObject({
                phases: {
                    install: {
                        "runtime-versions": {
                            "nodejs": 22
                        }
                    }
                }
            }),
            env: {
                "projectName": props.projectName
            },
            installCommands: nodeModulesInstallCommands,
            commands: [
                `npm run -w infra cli deploy-website ${stageName}`
            ],
            role: new iam.Role(this, `DeployWebsiteRole${stageName}`, {
                description: "Codebuild role to list CF exports to generate env variables & deploy website",
                assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
                inlinePolicies: {
                    "CrossAccountPolicy": new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: ["sts:AssumeRole"],
                                resources: [`arn:aws:iam::${projectConfigJson.account[stageName]?.number}:role/${props.projectName}-deploy-website`],
                            })]
                    }),
                    "CodeArtifactPolicy": new iam.PolicyDocument({
                        statements: codeArtifactStatements
                    }),
                    "AppSyncPolicy": new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: ["appsync:Get*",
                                    "appsync:List*",],
                                resources: ["*"],
                            })]
                    }),
                }
            }),
        })

        // add a dev deployment stage targeting dev account which is where the pipeline stack is deployed
        const devDeployStage = new DeployStage(this, PresetStageType.Dev, {
            ...props,
            accountName: PresetStageType.Dev,
            env: {
                account: this.account,
                region: this.region
            },
        })
        this.deploymentPipeline.addStage(devDeployStage).addPost(deployWebsiteStep(PresetStageType.Dev))

        const prodAccount = projectConfigJson.account[PresetStageType.Prod]

        if (prodAccount) {
            const prodDeployStage = new DeployStage(this, PresetStageType.Prod, {
                ...props,
                accountName: PresetStageType.Prod,
                env: {
                    account: prodAccount.number,
                    region: prodAccount.region
                },
            })
            const prodStage = this.deploymentPipeline.addStage(prodDeployStage)
            prodStage.addPre(new pipelines.ManualApprovalStep("Approve", { comment: "Manual approval to push changes Demo Portal." }))
            prodStage.addPost(deployWebsiteStep(PresetStageType.Prod))
        }
    }
}

