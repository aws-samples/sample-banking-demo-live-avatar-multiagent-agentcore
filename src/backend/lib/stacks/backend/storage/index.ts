import { aws_s3 as s3, aws_s3_deployment as s3_deployment } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import { LabsBucket, LabsStorageBucket } from "../../../common/constructs/s3";

interface LabsStorageProps {
    urls: string[];
}

export class LabsStorage extends Construct {
    public readonly storageBucket: s3.Bucket;

    constructor(scope: Construct, id: string, props: LabsStorageProps) {
        super(scope, id);

        const loggingBucket = new LabsBucket(this, "loggingBucket", {});

        this.storageBucket = new LabsStorageBucket(this, "storageBucket", {
            allowedOrigins: props.urls,
            eventBridgeEnabled: true,
            serverAccessLogsBucket: loggingBucket,
        });

        new s3_deployment.BucketDeployment(this, "storageDeployment", {
            sources: [s3_deployment.Source.asset(path.join(__dirname, "assets"))],
            destinationBucket: this.storageBucket,
            // prune: false,
        });
    }
}
