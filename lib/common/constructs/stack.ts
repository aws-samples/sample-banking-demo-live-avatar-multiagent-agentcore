import { Stack as StackConstruct, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

export class Stack extends StackConstruct {
    constructor(scope: Construct, id: string, props?: StackProps) {
        const prefix = scope.node.tryGetContext("projectId");
        const prefixedId = prefix ? `${prefix}-${id}` : id;
        super(scope, prefixedId, {
            ...props,
            description: `aws-labs-${prefixedId}`,
        });
    }
}
