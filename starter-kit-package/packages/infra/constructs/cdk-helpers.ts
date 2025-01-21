import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";

/** set the HTTPS only policy  */
export function setSecureTransport(bucket: s3.Bucket) {
    // appsec requirement
    bucket.addToResourcePolicy(
        new iam.PolicyStatement({
            actions: ["s3:*"],
            effect: iam.Effect.DENY,
            principals: [new iam.AnyPrincipal()],
            resources: [`${bucket.bucketArn}/*`, `${bucket.bucketArn}`],
            conditions: {
                Bool: {
                    "aws:SecureTransport": false,
                },
            },
        })
    );
}
