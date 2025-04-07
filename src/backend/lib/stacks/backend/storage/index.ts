import { aws_s3 as s3, aws_s3_deployment as s3_deployment } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import { CommonBucket, CommonStorageBucket } from "../../../common/constructs/s3";

interface StorageProps {
    urls: string[];
}

export class Storage extends Construct {
    public readonly storageBucket: s3.Bucket;

    constructor(scope: Construct, id: string, props: StorageProps) {
        super(scope, id);

        const { urls } = props;

        const loggingBucket = new CommonBucket(this, "loggingBucket", {});

        const storageBucket = new CommonStorageBucket(this, "storageBucket", {
            allowedOrigins: urls,
            eventBridgeEnabled: true,
            serverAccessLogsBucket: loggingBucket,
        });

        new s3_deployment.BucketDeployment(this, "storageDeployment", {
            sources: [s3_deployment.Source.asset(path.join(__dirname, "assets"))],
            destinationBucket: storageBucket,
            // prune: false,
        });

        this.storageBucket = storageBucket;
    }
}
