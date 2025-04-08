import { bedrock } from "@cdklabs/generative-ai-cdk-constructs";
import {
    aws_events as events,
    aws_events_targets as events_targets,
    aws_s3 as s3,
} from "aws-cdk-lib";
import { Construct } from "constructs";

interface KnowledgeProps {
    storageBucket: s3.Bucket;
}

export class Knowledge extends Construct {
    public readonly knowledgeBase: bedrock.VectorKnowledgeBase;

    constructor(scope: Construct, id: string, props: KnowledgeProps) {
        super(scope, id);

        const { storageBucket } = props;

        const knowledgeBase = new bedrock.VectorKnowledgeBase(this, "knowledgeBase", {
            embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        });

        const knowledgeSource = new bedrock.S3DataSource(this, "knowledgeSource", {
            bucket: storageBucket,
            knowledgeBase: knowledgeBase,
        });

        new events.Rule(this, "ingestionRule", {
            eventPattern: {
                source: ["aws.s3"],
                detail: {
                    bucket: {
                        name: [storageBucket.bucketName],
                    },
                },
            },
            targets: [
                new events_targets.AwsApi({
                    service: "bedrock-agent",
                    action: "startIngestionJob",
                    parameters: {
                        knowledgeBaseId: knowledgeBase.knowledgeBaseId,
                        dataSourceId: knowledgeSource.dataSourceId,
                    },
                }),
            ],
        });

        this.knowledgeBase = knowledgeBase;
    }
}
