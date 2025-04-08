import { RemovalPolicy } from "aws-cdk-lib";
import {
    BlockPublicAccess,
    Bucket,
    BucketProps,
    HttpMethods,
    ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

type CommonBucketProps = Omit<
    BucketProps,
    "blockPublicAccess" | "enforceSSL" | "serverAccessLogsPrefix"
>;

export class CommonBucket extends Bucket {
    constructor(scope: Construct, id: string, props: CommonBucketProps) {
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

interface CommonStorageBucketProps extends Omit<CommonBucketProps, "cors"> {
    allowedOrigins: string[];
}

export class CommonStorageBucket extends CommonBucket {
    constructor(scope: Construct, id: string, props: CommonStorageBucketProps) {
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
