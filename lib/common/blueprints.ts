import { InjectionContext, IPropertyInjector, RemovalPolicy } from "aws-cdk-lib";
import { Function, FunctionProps, Runtime, RuntimeFamily } from "aws-cdk-lib/aws-lambda";
import { LogGroup, LogGroupProps, RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket, BucketProps } from "aws-cdk-lib/aws-s3";

export class LogGroupInjector implements IPropertyInjector {
    public readonly constructUniqueId: string;

    constructor() {
        this.constructUniqueId = LogGroup.PROPERTY_INJECTION_ID;
    }

    public inject(originalProps: LogGroupProps): LogGroupProps {
        return {
            retention: RetentionDays.THREE_MONTHS,
            removalPolicy: RemovalPolicy.DESTROY,
            ...originalProps,
        };
    }
}

export class FunctionLogGroupInjector implements IPropertyInjector {
    public readonly constructUniqueId: string;

    constructor() {
        this.constructUniqueId = Function.PROPERTY_INJECTION_ID;
    }

    public inject(originalProps: FunctionProps, context: InjectionContext): FunctionProps {
        return {
            logGroup: new LogGroup(context.scope, `${context.id}LogGroup`),
            ...originalProps,
        };
    }
}

export class FunctionRuntimeInjector implements IPropertyInjector {
    public readonly constructUniqueId: string;

    constructor() {
        this.constructUniqueId = Function.PROPERTY_INJECTION_ID;
    }

    public inject(originalProps: FunctionProps): FunctionProps {
        return {
            ...originalProps,
            ...(originalProps.runtime.family === RuntimeFamily.NODEJS && {
                runtime: Runtime.NODEJS_22_X,
            }),
        };
    }
}

export class BucketInjector implements IPropertyInjector {
    public readonly constructUniqueId: string;

    constructor() {
        this.constructUniqueId = Bucket.PROPERTY_INJECTION_ID;
    }

    public inject(originalProps: BucketProps, context: InjectionContext): BucketProps {
        return {
            autoDeleteObjects: true,
            ...(originalProps?.serverAccessLogsBucket && {
                serverAccessLogsPrefix: `${context.id}/`,
            }),
            ...originalProps,
            ...((originalProps?.autoDeleteObjects ?? true) && {
                removalPolicy: RemovalPolicy.DESTROY,
            }),
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
        };
    }
}

export function getPropertyInjectors(): IPropertyInjector[] {
    return [new LogGroupInjector(), new FunctionLogGroupInjector(), new BucketInjector()];
}
