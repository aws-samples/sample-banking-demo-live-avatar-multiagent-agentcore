import * as lambdaPython from "@aws-cdk/aws-lambda-python-alpha";
import { Architecture, LayerVersion, LayerVersionProps, Runtime } from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export const architecture = Architecture.ARM_64;
export const nodejsRuntime = Runtime.NODEJS_22_X;
export const pythonRuntime = Runtime.PYTHON_3_12;

export class NodejsLayerVersion extends LayerVersion {
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

export class NodejsFunction extends lambdaNodejs.NodejsFunction {
    constructor(
        scope: Construct,
        id: string,
        props: Omit<lambdaNodejs.NodejsFunctionProps, "architecture" | "runtime">
    ) {
        super(scope, id, {
            architecture,
            runtime: nodejsRuntime,
            ...props,
        });
    }
}

export class PythonLayerVersion extends lambdaPython.PythonLayerVersion {
    constructor(
        scope: Construct,
        id: string,
        props: Omit<
            lambdaPython.PythonLayerVersionProps,
            "compatibleArchitectures" | "compatibleRuntimes"
        >
    ) {
        super(scope, id, {
            compatibleArchitectures: [architecture],
            compatibleRuntimes: [pythonRuntime],
            ...props,
        });
    }
}

export class PythonFunction extends lambdaPython.PythonFunction {
    constructor(
        scope: Construct,
        id: string,
        props: Omit<lambdaPython.PythonFunctionProps, "architecture" | "runtime">
    ) {
        super(scope, id, {
            architecture,
            runtime: pythonRuntime,
            ...props,
        });
    }
}
