import { Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import * as path from "path";
import { CommonBucket, CommonWebBucket } from "../../../common/constructs/s3";

interface StorageProps {
    urls: string[];
}

export class Storage extends Construct {
    public readonly storageBucket: Bucket;

    constructor(scope: Construct, id: string, props: StorageProps) {
        super(scope, id);

        const { urls } = props;

        const loggingBucket = new CommonBucket(this, "loggingBucket", {});

        const storageBucket = new CommonWebBucket(this, "storageBucket", {
            allowedOrigins: urls,
            eventBridgeEnabled: true,
            serverAccessLogsBucket: loggingBucket,
        });

        new BucketDeployment(this, "storageDeployment", {
            sources: [Source.asset(path.join(__dirname, "assets"))],
            destinationBucket: storageBucket,
            // prune: false,
        });

        this.storageBucket = storageBucket;
    }
}
