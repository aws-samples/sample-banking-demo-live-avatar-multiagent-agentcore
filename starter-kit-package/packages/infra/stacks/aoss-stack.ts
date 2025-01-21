import { RemovalPolicy, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CDKProps } from "../config/AppConfig";
import { Effect, IRole, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { CfnAccessPolicy, CfnSecurityPolicy, CfnCollection, CfnVpcEndpoint } from "aws-cdk-lib/aws-opensearchserverless";
import { NagSuppressions } from "cdk-nag";
import { SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";

interface AossStackProps extends CDKProps {
    vpc: Vpc;
    defaultSecurityGroup: SecurityGroup;
}

export class AossStack extends Stack {
    // AOSS Collection & Exec Role
    public readonly vectorCollection: CfnCollection;
    public readonly aossVPCEndpoint: CfnVpcEndpoint;
    public readonly lambdaExecutionRole: Role;

    constructor(scope: Construct, id: string, props: AossStackProps) {
        super(scope, id, props);

        const assetCollectionName = "product-collection";

        // create a vpc endpoint for AWS Opensearch serverless
        this.aossVPCEndpoint = new CfnVpcEndpoint(this, "aoss-vpc-endpoint", {
            name: "aoss-vpc-endpoint", // Expected maxLength: 32
            vpcId: props.vpc.vpcId,
            subnetIds: props.vpc.selectSubnets({
                subnetType: SubnetType.PRIVATE_WITH_EGRESS,
            }).subnetIds,
            securityGroupIds: [props.defaultSecurityGroup.securityGroupId]
        });
        // to prevent stack deployment errors upon any changes to polices below
        this.aossVPCEndpoint.applyRemovalPolicy(RemovalPolicy.DESTROY)


        /**
        * This role is shared between AOSS stack & the api stack so the lambdas within  a VPC have access to AOSS and all the policies associated with this collection. The role is declared here to avoid cyclic dependency issues with CDK 
        */
        this.lambdaExecutionRole = new Role(this, `${props.projectName}-lambda-execution-role`, {
            assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
                ManagedPolicy.fromAwsManagedPolicyName("AmazonBedrockFullAccess"),
                ManagedPolicy.fromAwsManagedPolicyName(`service-role/AWSLambdaVPCAccessExecutionRole`)
            ]
        });
        // allow this execution tole to access all AWS OpenSearch collections and features
        this.lambdaExecutionRole.addToPolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                "aoss:*",
                "aoss:APIAccessAll",
                "bedrock:*",
                "es:*"
            ],
            resources: ["*"]
        }))


        // allow decrypt
        this.lambdaExecutionRole.addToPolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                "kms:Decrypt",
                "kms:DescribeKey",
                "kms:Encrypt",
                "kms:GenerateDataKey*",
                "kms:ReEncrypt*"
            ],
            resources: [`arn:aws:kms:${this.region}:${this.account}:key/*`]
        }))

        // uncomment following to allow bucket permissions if you run into CDK cyclic dependency with lambda functions using this role to access either the data bucket under Data Stack or other S3 buckets part of this project. NOTE: due to AppSec requirement and to avoid providing a * permission, we have provided a modified ARN to oly allow access to buckets that starts with this project name which you may change as per your requirement 
        // this.lambdaExecutionRole.addToPolicy(new PolicyStatement({
        //     effect: Effect.ALLOW,
        //     actions: [
        //         "s3:Abort*",
        //         "s3:DeleteObject*",
        //         "s3:GetBucket*",
        //         "s3:GetObject*",
        //         "s3:List*",
        //         "s3:PutObject",
        //         "s3:PutObjectLegalHold",
        //         "s3:PutObjectRetention",
        //         "s3:PutObjectTagging",
        //         "s3:PutObjectVersionTagging"
        //     ],
        //     resources: [`arn:aws:s3:::${props.projectName}*`]
        // }))

        /**
                * Nag Suppressions
                */
        NagSuppressions.addResourceSuppressions(
            this.lambdaExecutionRole,
            [
                {
                    id: "AwsSolutions-IAM4",
                    reason: "using Managed IAM policies to speed up development",
                },
                {
                    id: "AwsSolutions-IAM5",
                    reason: "using permissive IAM policies with * to resources to speed up development",
                }
            ],
            true
        );


        const assetNetworkPolicy = new CfnSecurityPolicy(this, assetCollectionName + "np", {
            name: assetCollectionName + "np",
            type: "network",
            policy: "policy"
        });

        assetNetworkPolicy.policy = JSON.stringify(
            [
                {
                    "Description": "network public access",
                    "Rules": [
                        {
                            "ResourceType": "collection",
                            "Resource": [
                                `collection/${assetCollectionName}`
                            ]
                        },
                        {
                            "ResourceType": "dashboard",
                            "Resource": [
                                `collection/${assetCollectionName}`
                            ]
                        }
                    ],
                    "AllowFromPublic": true,
                    // "SourceVPCEs": [
                    //     `${this.aossVPCEndpoint.ref}`
                    // ]

                }
            ]
        )
        const assetEncryptionPolicy = new CfnSecurityPolicy(this, assetCollectionName + "-asset-ep", {
            name: assetCollectionName + "asset-ep",
            type: "encryption",
            policy: "policy"
        });
        assetEncryptionPolicy.policy = JSON.stringify(
            {
                "Rules": [
                    {
                        "ResourceType": "collection",
                        "Resource": [
                            `collection/${assetCollectionName}`
                        ]
                    }
                ],
                "AWSOwnedKey": true
            }
        )

        const assetDataAccessPolicy = new CfnAccessPolicy(this, assetCollectionName + "-dap", {
            name: assetCollectionName + "dap",
            policy: "policy",
            type: "data",
        });

        assetDataAccessPolicy.policy = JSON.stringify([
            {
                Description: "Full Data Access",
                Rules: [
                    {
                        Permission: [
                            "aoss:*",
                        ],
                        ResourceType: "collection",
                        Resource: [`collection/${assetCollectionName}`],
                    },
                    {
                        Permission: [
                            "aoss:*",
                        ],
                        ResourceType: "index",
                        Resource: [`index/${assetCollectionName}/*`],
                    },
                ],
                Principal: [this.lambdaExecutionRole.roleArn, `arn:aws:iam::${this.account}:role/Admin`, `arn:aws:iam::${this.account}:role/admin`],
            },
        ]);


        this.vectorCollection = new CfnCollection(
            this,
            assetCollectionName,
            {
                name: assetCollectionName,
                description: "Asset collection of each product",
                type: 'VECTORSEARCH',
                standbyReplicas: "ENABLED"
            }
        )
        this.vectorCollection.addDependency(assetNetworkPolicy);
        this.vectorCollection.addDependency(assetEncryptionPolicy);
        this.vectorCollection.addDependency(assetDataAccessPolicy);
    }
}

