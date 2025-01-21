import { Stack, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
    BlockPublicAccess,
    Bucket,
    BucketEncryption,
    HttpMethods,
    ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import { setSecureTransport } from "../constructs/cdk-helpers";
import { CDKProps } from "../config/AppConfig";
import { Key } from "aws-cdk-lib/aws-kms";

interface BucketStackProps extends CDKProps {
    distributionDomainName: string;
    projectAccessLogsBucket: Bucket;
    kmsKey: Key;
}


export class BucketStack extends Stack {
    public readonly dataBucket: Bucket;
    constructor(scope: Construct, id: string, props: BucketStackProps) {
        super(scope, id, props);

        // content bucket with access to front end
        this.dataBucket = new Bucket(this, "data-bucket", {
            bucketName: `${props.projectName}-data-bucket-${this.account}-${this.region}`,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            encryption: BucketEncryption.KMS,
            encryptionKey: props.kmsKey,
            removalPolicy: RemovalPolicy.RETAIN,
            serverAccessLogsBucket: props.projectAccessLogsBucket,
            serverAccessLogsPrefix: "data-bucket",
            enforceSSL: true,
            cors: [
                {
                    allowedMethods: [HttpMethods.GET, HttpMethods.POST, HttpMethods.PUT, HttpMethods.HEAD, HttpMethods.DELETE],
                    allowedOrigins: ["http://localhost:3000", `https://${props.distributionDomainName}`],
                    allowedHeaders: ["*"],
                    exposedHeaders: ["x-amz-server-side-encryption",
                        "x-amz-request-id",
                        "x-amz-id-2",
                        "ETag",
                        "x-amz-meta-foo"],
                    maxAge: 3000,

                },
            ],
        });
        setSecureTransport(this.dataBucket);

        // knowledge data bucket resource  Outputs
        new CfnOutput(this, "config-s3-data-bucket-name", {
            value: this.dataBucket.bucketName,
            description: "Data bucket name",
            exportName: `${props.projectName}-config-s3-data-bucket-name`,
        });
        // knowledge data bucket resource  Outputs
        new CfnOutput(this, "config-s3-data-bucket-arn", {
            value: this.dataBucket.bucketArn,
            description: "data bucket ARN",
            exportName: `${props.projectName}-config-s3-data-bucket-arn`,
        });
    }
}