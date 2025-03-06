import { RemovalPolicy } from "aws-cdk-lib";
import {
    BlockPublicAccess,
    Bucket,
    BucketProps,
    HttpMethods,
    ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

type LabsBucketProps = Omit<
    BucketProps,
    "blockPublicAccess" | "enforceSSL" | "serverAccessLogsPrefix"
>;

export class LabsBucket extends Bucket {
    constructor(scope: Construct, id: string, props: LabsBucketProps) {
        super(scope, id, {
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            serverAccessLogsPrefix: `${id}/`,
            objectOwnership: props.serverAccessLogsBucket
                ? undefined
                : ObjectOwnership.BUCKET_OWNER_PREFERRED,
            ...props,
        });
    }
}

interface LabsStorageBucketProps extends Omit<LabsBucketProps, "cors"> {
    allowedOrigins: string[];
}

export class LabsStorageBucket extends LabsBucket {
    constructor(scope: Construct, id: string, props: LabsStorageBucketProps) {
        super(scope, id, {
            cors: [
                {
                    allowedMethods: [
                        HttpMethods.GET,
                        HttpMethods.POST,
                        HttpMethods.PUT,
                        HttpMethods.HEAD,
                        HttpMethods.DELETE,
                    ],
                    allowedOrigins: props.allowedOrigins,
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
            ...props,
        });
    }
}
