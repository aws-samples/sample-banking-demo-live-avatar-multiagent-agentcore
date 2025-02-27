// import { bedrock } from "@cdklabs/generative-ai-cdk-constructs";
import {
    StackProps,
    // aws_events as events,
    // aws_events_targets as events_targets,
    aws_s3 as s3,
    aws_s3_deployment as s3_deployment,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import { LabsBucket } from "../../constructs/s3";
import { LabsStack } from "../../constructs/stack";

interface StorageStackProps extends StackProps {
    urls: string[];
}

export class StorageStack extends LabsStack {
    public readonly storageBucket: s3.Bucket;
    public readonly knowledgeBucket: s3.Bucket;
    // public readonly knowledgeBase: bedrock.KnowledgeBase;

    constructor(scope: Construct, id: string, props: StorageStackProps) {
        super(scope, id, props);

        const loggingBucket = new LabsBucket(this, "loggingBucket", {
            objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
        });

        this.storageBucket = new LabsBucket(this, "storageBucket", {
            serverAccessLogsBucket: loggingBucket,
            cors: [
                {
                    allowedMethods: [
                        s3.HttpMethods.GET,
                        s3.HttpMethods.POST,
                        s3.HttpMethods.PUT,
                        s3.HttpMethods.HEAD,
                        s3.HttpMethods.DELETE,
                    ],
                    allowedOrigins: props.urls,
                    allowedHeaders: ["*"],
                    exposedHeaders: [
                        "x-amz-server-side-encryption",
                        "x-amz-request-id",
                        "x-amz-id-2",
                        "ETag",
                        "x-amz-meta-foo",
                    ],
                    maxAge: 3000,
                },
            ],
        });

        // this.knowledgeBucket = new LabsBucket(this, "knowledgeBucket", {
        //     serverAccessLogsBucket: loggingBucket,
        //     eventBridgeEnabled: true,
        // });

        // this.knowledgeBase = new bedrock.KnowledgeBase(this, "knowledgeBase", {
        //     embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        // });

        // const knowledgeSource = new bedrock.S3DataSource(this, "knowledgeSource", {
        //     bucket: this.knowledgeBucket,
        //     knowledgeBase: this.knowledgeBase,
        // });

        // new events.Rule(this, "ingestionRule", {
        //     eventPattern: {
        //         source: ["aws.s3"],
        //         detail: {
        //             bucket: {
        //                 name: [this.knowledgeBucket.bucketName],
        //             },
        //         },
        //     },
        //     targets: [
        //         new events_targets.AwsApi({
        //             service: "bedrock-agent",
        //             action: "startIngestionJob",
        //             parameters: {
        //                 knowledgeBaseId: this.knowledgeBase.knowledgeBaseId,
        //                 dataSourceId: knowledgeSource.dataSourceId,
        //             },
        //         }),
        //     ],
        // });
    }
}

interface StorageHydrateStackProps extends StackProps {
    storageBucket: s3.Bucket;
}

export class StorageHydrateStack extends LabsStack {
    constructor(scope: Construct, id: string, props: StorageHydrateStackProps) {
        super(scope, id, props);

        new s3_deployment.BucketDeployment(this, "storageDeployment", {
            sources: [s3_deployment.Source.asset(path.join(__dirname, "assets"))],
            destinationBucket: props.storageBucket,
            // prune: false,
        });
    }
}
