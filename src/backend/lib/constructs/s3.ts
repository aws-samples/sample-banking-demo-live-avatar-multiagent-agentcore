import { RemovalPolicy } from "aws-cdk-lib";
import { BlockPublicAccess, Bucket, BucketProps } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class LabsBucket extends Bucket {
    constructor(
        scope: Construct,
        id: string,
        props: Omit<BucketProps, "blockPublicAccess" | "enforceSSL" | "serverAccessLogsPrefix">
    ) {
        super(scope, id, {
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            serverAccessLogsPrefix: `${id}/`,
            ...props,
        });
    }
}
