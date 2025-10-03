import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export class Stack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        const prefix = scope.node.tryGetContext("projectId");
        const prefixedId = prefix ? `${prefix}-${id}` : id;
        super(scope, prefixedId, {
            ...props,
            description: `aws-labs-${prefixedId}`,
        });
    }
}
