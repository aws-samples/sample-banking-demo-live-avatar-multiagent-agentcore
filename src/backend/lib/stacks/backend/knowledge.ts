import { bedrock } from "@cdklabs/generative-ai-cdk-constructs";
import {
    aws_events as events,
    aws_events_targets as events_targets,
    aws_s3 as s3,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export interface LabsKnowledgeProps {
    storageBucket: s3.Bucket;
}

export class LabsKnowledge extends Construct {
    public readonly knowledgeBase: bedrock.VectorKnowledgeBase;

    constructor(scope: Construct, id: string, props: LabsKnowledgeProps) {
        super(scope, id);

        this.knowledgeBase = new bedrock.VectorKnowledgeBase(this, "knowledgeBase", {
            embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        });

        const knowledgeSource = new bedrock.S3DataSource(this, "knowledgeSource", {
            bucket: props.storageBucket,
            knowledgeBase: this.knowledgeBase,
        });

        new events.Rule(this, "ingestionRule", {
            eventPattern: {
                source: ["aws.s3"],
                detail: {
                    bucket: {
                        name: [props.storageBucket.bucketName],
                    },
                },
            },
            targets: [
                new events_targets.AwsApi({
                    service: "bedrock-agent",
                    action: "startIngestionJob",
                    parameters: {
                        knowledgeBaseId: this.knowledgeBase.knowledgeBaseId,
                        dataSourceId: knowledgeSource.dataSourceId,
                    },
                }),
            ],
        });
    }
}
