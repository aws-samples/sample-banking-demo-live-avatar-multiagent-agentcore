import {
    PythonFunction,
    PythonFunctionProps,
    PythonLayerVersion,
    PythonLayerVersionProps,
} from "@aws-cdk/aws-lambda-python-alpha";
import { Architecture, LayerVersion, LayerVersionProps, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export const architecture = Architecture.ARM_64;

export const nodejsRuntime = Runtime.NODEJS_22_X;

export class CommonNodejsLayerVersion extends LayerVersion {
    constructor(
        scope: Construct,
        id: string,
        props: Omit<LayerVersionProps, "compatibleArchitectures" | "compatibleRuntimes">
    ) {
        super(scope, id, {
            compatibleArchitectures: [architecture],
            compatibleRuntimes: [nodejsRuntime],
            ...props,
        });
    }
}

export class CommonNodejsFunction extends NodejsFunction {
    constructor(
        scope: Construct,
        id: string,
        props: Omit<NodejsFunctionProps, "architecture" | "runtime">
    ) {
        super(scope, id, {
            architecture,
            runtime: nodejsRuntime,
            ...props,
        });
    }
}

export const pythonRuntime = Runtime.PYTHON_3_12;

export class CommonPythonLayerVersion extends PythonLayerVersion {
    constructor(
        scope: Construct,
        id: string,
        props: Omit<PythonLayerVersionProps, "compatibleArchitectures" | "compatibleRuntimes">
    ) {
        super(scope, id, {
            compatibleArchitectures: [architecture],
            compatibleRuntimes: [pythonRuntime],
            ...props,
        });
    }
}

type CommonPythonFunctionProps = Omit<PythonFunctionProps, "architecture" | "runtime">;

export class CommonPythonFunction extends PythonFunction {
    constructor(scope: Construct, id: string, props: CommonPythonFunctionProps) {
        super(scope, id, {
            architecture,
            runtime: pythonRuntime,
            ...props,
        });
    }
}
