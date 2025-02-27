import {
    PythonFunction,
    PythonFunctionProps,
    PythonLayerVersion,
    PythonLayerVersionProps,
} from "@aws-cdk/aws-lambda-python-alpha";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

const commonFunctionProps = {
    architecture: Architecture.ARM_64,
    logRetention: RetentionDays.THREE_MONTHS,
};

export class LabsNodejsFunction extends NodejsFunction {
    constructor(
        scope: Construct,
        id: string,
        props: Omit<NodejsFunctionProps, "architecture" | "runtime" | "logRetention">
    ) {
        super(scope, id, {
            ...commonFunctionProps,
            runtime: Runtime.NODEJS_22_X,
            ...props,
        });
    }
}

const pythonRuntime = Runtime.PYTHON_3_12;

export class LabsPythonFunction extends PythonFunction {
    constructor(
        scope: Construct,
        id: string,
        props: Omit<PythonFunctionProps, "architecture" | "runtime" | "logRetention">
    ) {
        super(scope, id, {
            ...commonFunctionProps,
            runtime: pythonRuntime,
            ...props,
        });
    }
}

export class LabsPythonLayerVersion extends PythonLayerVersion {
    constructor(
        scope: Construct,
        id: string,
        props: Omit<PythonLayerVersionProps, "compatibleArchitectures" | "compatibleRuntimes">
    ) {
        super(scope, id, {
            compatibleArchitectures: [commonFunctionProps.architecture],
            compatibleRuntimes: [pythonRuntime],
            ...props,
        });
    }
}
