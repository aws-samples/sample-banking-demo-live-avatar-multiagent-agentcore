import {
    Aws,
    CfnOutput,
    CfnResource,
    CustomResource,
    Duration,
    RemovalPolicy,
    StackProps,
} from "aws-cdk-lib";
import { CfnDataSource, CfnKnowledgeBase } from "aws-cdk-lib/aws-bedrock";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Effect, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import {
    Architecture,
    Code,
    Function as LambdaFunction,
    Runtime,
    SingletonFunction,
} from "aws-cdk-lib/aws-lambda";
import { LambdaDestination } from "aws-cdk-lib/aws-s3-notifications";
import { CfnGraph } from "aws-cdk-lib/aws-neptunegraph";
import { Bucket, EventType, HttpMethods } from "aws-cdk-lib/aws-s3";
import { CfnIndex, CfnVectorBucket } from "aws-cdk-lib/aws-s3vectors";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";
import { Stack } from "../common/constructs/stack";
import { getFeatureFlags, getModelConfig, getStackNameBase } from "../common/feature-flags";

export class Shared extends Stack {
    public readonly sessionsTable: Table;
    public readonly customersTable: Table;
    public readonly metadataTable: Table;
    public readonly reportsBucket: Bucket;
    public readonly imagesBucket: Bucket;
    public readonly kbDocsBucket: Bucket;
    public readonly avatarBucket: Bucket;
    public readonly knowledgeBaseId?: string;
    public readonly kbDataSourceId?: string;

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const features = getFeatureFlags(this.node);
        const models = getModelConfig(this.node);
        const stackName = getStackNameBase(this.node);

        // ─── DynamoDB Tables ───────────────────────────────────────────
        this.sessionsTable = new Table(this, "SessionsTable", {
            tableName: `${stackName}-sessions`,
            partitionKey: { name: "sessionId", type: AttributeType.STRING },
            billingMode: BillingMode.PAY_PER_REQUEST,
            timeToLiveAttribute: "ttl",
            removalPolicy: RemovalPolicy.DESTROY,
        });
        NagSuppressions.addResourceSuppressions(this.sessionsTable, [
            { id: "AwsSolutions-DDB3", reason: "PITR not required for demo session data." },
        ]);

        this.customersTable = new Table(this, "CustomersTable", {
            tableName: `${stackName}-customers`,
            partitionKey: { name: "customerId", type: AttributeType.STRING },
            billingMode: BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.DESTROY,
        });
        NagSuppressions.addResourceSuppressions(this.customersTable, [
            { id: "AwsSolutions-DDB3", reason: "PITR not required for demo customer data." },
        ]);

        this.metadataTable = new Table(this, "MetadataTable", {
            tableName: `${stackName}-metadata`,
            partitionKey: { name: "PK", type: AttributeType.STRING },
            sortKey: { name: "SK", type: AttributeType.STRING },
            billingMode: BillingMode.PAY_PER_REQUEST,
            timeToLiveAttribute: "ttl",
            removalPolicy: RemovalPolicy.DESTROY,
        });
        NagSuppressions.addResourceSuppressions(this.metadataTable, [
            { id: "AwsSolutions-DDB3", reason: "PITR not required for demo metadata." },
        ]);

        // ─── S3 Buckets ────────────────────────────────────────────────
        // BucketInjector handles blockPublicAccess, enforceSSL, autoDelete, DESTROY
        this.reportsBucket = new Bucket(this, "ReportsBucket", {
            bucketName: `${stackName}-reports-${Aws.ACCOUNT_ID}`,
            encryption: undefined, // S3_MANAGED default
            lifecycleRules: [{ expiration: Duration.days(90) }],
            cors: [
                {
                    allowedMethods: [HttpMethods.GET],
                    allowedOrigins: ["*"],
                    allowedHeaders: ["*"],
                },
            ],
        });

        this.imagesBucket = new Bucket(this, "ImagesBucket", {
            bucketName: `${stackName}-images-${Aws.ACCOUNT_ID}`,
            lifecycleRules: [{ expiration: Duration.days(30) }],
            cors: [
                {
                    allowedMethods: [HttpMethods.GET, HttpMethods.PUT],
                    allowedOrigins: ["*"],
                    allowedHeaders: ["*"],
                },
            ],
        });

        this.kbDocsBucket = new Bucket(this, "KbDocsBucket", {
            bucketName: `${stackName}-kb-docs-${Aws.ACCOUNT_ID}`,
        });

        this.avatarBucket = new Bucket(this, "AvatarBucket", {
            bucketName: `${stackName}-avatar-${Aws.ACCOUNT_ID}`,
            lifecycleRules: [{ expiration: Duration.days(30) }],
            cors: [
                {
                    allowedMethods: [HttpMethods.GET, HttpMethods.PUT],
                    allowedOrigins: ["*"],
                    allowedHeaders: ["*"],
                },
            ],
        });

        // ─── Knowledge Base (feature-gated) ────────────────────────────
        if (features.knowledge_base && features.kb_backend === "s3-vectors") {
            const kbRole = new Role(this, "KbRole", {
                assumedBy: new ServicePrincipal("bedrock.amazonaws.com"),
                description: "Execution role for Bedrock Knowledge Base",
            });

            const kbSupplementalBucket = new Bucket(this, "KbSupplementalBucket", {
                bucketName: `${stackName}-kb-supplemental-${Aws.ACCOUNT_ID}`,
            });

            this.kbDocsBucket.grantReadWrite(kbRole);
            kbSupplementalBucket.grantReadWrite(kbRole);

            // InvokeModel on the embedding model, plus the multimodal parser
            // model when kb_multimodal is on (the FOUNDATION_MODEL parser calls
            // it during ingestion to extract text + imagery from documents).
            kbRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["bedrock:InvokeModel"],
                    resources: [
                        `arn:aws:bedrock:${Aws.REGION}::foundation-model/${models.kb_embedding}`,
                        ...(features.kb_multimodal
                            ? [
                                  `arn:aws:bedrock:${Aws.REGION}::foundation-model/${models.kb_parser}`,
                              ]
                            : []),
                    ],
                })
            );

            // S3 Vectors
            const vectorBucketName = `${stackName}-kb-vectors`;
            const vectorIndexName = `${stackName}-kb-idx-v2`;
            const vectorBucket = new CfnVectorBucket(this, "KbVectorBucket", {
                vectorBucketName,
            });

            const vectorIndex = new CfnIndex(this, "KbVectorIndex", {
                vectorBucketName,
                indexName: vectorIndexName,
                dataType: "float32",
                dimension: 1024,
                distanceMetric: "cosine",
                metadataConfiguration: {
                    nonFilterableMetadataKeys: ["AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA"],
                },
            });
            vectorIndex.addDependency(vectorBucket);

            kbRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        "s3vectors:PutVectors",
                        "s3vectors:GetVectors",
                        "s3vectors:DeleteVectors",
                        "s3vectors:QueryVectors",
                        "s3vectors:GetIndex",
                    ],
                    resources: [vectorIndex.attrIndexArn],
                })
            );

            // IAM eventual consistency waiter
            const iamWaiterFn = new SingletonFunction(this, "IamWaiterFunction", {
                uuid: "iam-propagation-waiter-45s",
                runtime: Runtime.PYTHON_3_13,
                architecture: Architecture.ARM_64,
                handler: "index.handler",
                timeout: Duration.seconds(90),
                code: Code.fromInline(`
import time
import cfnresponse
def handler(event, context):
    if event["RequestType"] in ["Create", "Update"]:
        time.sleep(45)
    cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
`),
            });
            const iamWaiter = new CustomResource(this, "IamPropagationWaiter", {
                serviceToken: iamWaiterFn.functionArn,
            });
            const defaultPolicy = kbRole.node.tryFindChild("DefaultPolicy") as
                | CfnResource
                | undefined;
            if (defaultPolicy) {
                const policyCfn = defaultPolicy.node.defaultChild as CfnResource;
                const waiterCfn = iamWaiter.node.defaultChild as CfnResource;
                if (policyCfn && waiterCfn) {
                    waiterCfn.addDependency(policyCfn);
                }
            }

            const kb = new CfnKnowledgeBase(this, "KnowledgeBase", {
                name: `${stackName}-kb-v2`,
                description: `Knowledge base for ${stackName}`,
                roleArn: kbRole.roleArn,
                knowledgeBaseConfiguration: {
                    type: "VECTOR",
                    vectorKnowledgeBaseConfiguration: {
                        embeddingModelArn: `arn:aws:bedrock:${Aws.REGION}::foundation-model/${models.kb_embedding}`,
                        embeddingModelConfiguration: {
                            bedrockEmbeddingModelConfiguration: {
                                dimensions: 1024,
                                embeddingDataType: "FLOAT32",
                            },
                        },
                        supplementalDataStorageConfiguration: {
                            supplementalDataStorageLocations: [
                                {
                                    supplementalDataStorageLocationType: "S3",
                                    s3Location: { uri: `s3://${kbSupplementalBucket.bucketName}/` },
                                },
                            ],
                        },
                    },
                },
                storageConfiguration: {
                    type: "S3_VECTORS",
                    s3VectorsConfiguration: {
                        indexArn: vectorIndex.attrIndexArn,
                    },
                },
            });
            kb.addDependency(vectorIndex);
            kb.node.addDependency(kbRole);
            const waiterCfnForKb = iamWaiter.node.defaultChild as CfnResource;
            if (waiterCfnForKb) {
                kb.addDependency(waiterCfnForKb);
            }

            // Multimodal parsing extracts imagery from ingested documents so the
            // KB can return visual tiles alongside text. The parsing strategy
            // cannot be changed on an existing data source in place (see AWS
            // docs), so when kb_multimodal is on we use a distinct construct id
            // + name — CloudFormation creates the multimodal data source and
            // removes the text-only one, and re-ingestion runs against it.
            const multimodalKb = features.kb_multimodal;
            const dataSource = new CfnDataSource(
                this,
                multimodalKb ? "KbDataSourceMultimodal" : "KbDataSource",
                {
                    knowledgeBaseId: kb.attrKnowledgeBaseId,
                    name: multimodalKb ? `${stackName}-kb-docs-mm` : `${stackName}-kb-docs`,
                    description: "Knowledge base document source",
                    dataSourceConfiguration: {
                        type: "S3",
                        s3Configuration: {
                            bucketArn: this.kbDocsBucket.bucketArn,
                            inclusionPrefixes: ["generated/"],
                        },
                    },
                    ...(multimodalKb
                        ? {
                              vectorIngestionConfiguration: {
                                  parsingConfiguration: {
                                      parsingStrategy: "BEDROCK_FOUNDATION_MODEL",
                                      bedrockFoundationModelConfiguration: {
                                          modelArn: `arn:aws:bedrock:${Aws.REGION}::foundation-model/${models.kb_parser}`,
                                          parsingModality: "MULTIMODAL",
                                      },
                                  },
                              },
                          }
                        : {}),
                }
            );
            dataSource.addDependency(kb);

            this.knowledgeBaseId = kb.attrKnowledgeBaseId;
            this.kbDataSourceId = dataSource.attrDataSourceId;

            new StringParameter(this, "KbIdParam", {
                parameterName: `/${stackName}/knowledge_base_id`,
                stringValue: kb.attrKnowledgeBaseId,
            });

            new StringParameter(this, "KbDataSourceIdParam", {
                parameterName: `/${stackName}/kb_data_source_id`,
                stringValue: dataSource.attrDataSourceId,
            });

            new StringParameter(this, "KbDocsBucketParam", {
                parameterName: `/${stackName}/kb_docs_bucket`,
                stringValue: this.kbDocsBucket.bucketName,
            });

            new CfnOutput(this, "KnowledgeBaseId", {
                value: kb.attrKnowledgeBaseId,
                description: "Bedrock Knowledge Base ID",
            });

            // ─── KB Auto-Ingestion Lambda ────────────────────────────────
            const kbIngestLambda = new LambdaFunction(this, "KbIngestFunction", {
                functionName: `${stackName}-kb-ingest`,
                runtime: Runtime.PYTHON_3_13,
                architecture: Architecture.ARM_64,
                handler: "handler.handler",
                code: Code.fromAsset(
                    path.join(__dirname, "..", "..", "gateway", "tools", "kb_ingest")
                ),
                timeout: Duration.seconds(60),
                environment: {
                    KB_DOCS_BUCKET: this.kbDocsBucket.bucketName,
                    KNOWLEDGE_BASE_ID: kb.attrKnowledgeBaseId,
                    DATA_SOURCE_ID: dataSource.attrDataSourceId,
                },
            });

            this.reportsBucket.grantRead(kbIngestLambda);
            this.kbDocsBucket.grantPut(kbIngestLambda);
            kbIngestLambda.addToRolePolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["s3:PutObjectTagging"],
                    resources: [this.kbDocsBucket.arnForObjects("*")],
                })
            );
            kbIngestLambda.addToRolePolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["bedrock:StartIngestionJob"],
                    resources: [
                        `arn:aws:bedrock:${Aws.REGION}:${Aws.ACCOUNT_ID}:knowledge-base/${kb.attrKnowledgeBaseId}`,
                    ],
                })
            );

            this.reportsBucket.addEventNotification(
                EventType.OBJECT_CREATED,
                new LambdaDestination(kbIngestLambda),
                { prefix: "reports/", suffix: ".pdf" }
            );
            this.reportsBucket.addEventNotification(
                EventType.OBJECT_CREATED,
                new LambdaDestination(kbIngestLambda),
                { prefix: "menus/", suffix: ".pdf" }
            );
        }

        // ─── Neptune Analytics (feature-gated) ─────────────────────────
        if (features.neptune) {
            const neptuneGraph = new CfnGraph(this, "NeptuneGraph", {
                graphName: `${stackName}-memory`.replace(/-/g, ""),
                provisionedMemory: 32,
                publicConnectivity: true,
                replicaCount: 0,
                deletionProtection: false,
                vectorSearchConfiguration: {
                    vectorSearchDimension: 1024,
                },
            });

            new StringParameter(this, "NeptuneEndpointParam", {
                parameterName: `/${stackName}/neptune_endpoint`,
                stringValue: neptuneGraph.attrEndpoint,
            });

            new StringParameter(this, "NeptuneGraphIdParam", {
                parameterName: `/${stackName}/neptune_graph_id`,
                stringValue: neptuneGraph.attrGraphId,
            });

            new CfnOutput(this, "NeptuneEndpoint", {
                value: neptuneGraph.attrEndpoint,
                description: "Neptune Analytics endpoint",
            });
        }

        // ─── SSM Parameters ────────────────────────────────────────────
        new StringParameter(this, "SessionsTableParam", {
            parameterName: `/${stackName}/sessions_table`,
            stringValue: this.sessionsTable.tableName,
        });

        new StringParameter(this, "CustomersTableParam", {
            parameterName: `/${stackName}/customers_table`,
            stringValue: this.customersTable.tableName,
        });

        new StringParameter(this, "MetadataTableParam", {
            parameterName: `/${stackName}/metadata_table`,
            stringValue: this.metadataTable.tableName,
        });

        new StringParameter(this, "ReportsBucketParam", {
            parameterName: `/${stackName}/reports_bucket`,
            stringValue: this.reportsBucket.bucketName,
        });

        new StringParameter(this, "ImagesBucketParam", {
            parameterName: `/${stackName}/images_bucket`,
            stringValue: this.imagesBucket.bucketName,
        });

        new StringParameter(this, "AvatarBucketParam", {
            parameterName: `/${stackName}/avatar_bucket`,
            stringValue: this.avatarBucket.bucketName,
        });
    }
}
