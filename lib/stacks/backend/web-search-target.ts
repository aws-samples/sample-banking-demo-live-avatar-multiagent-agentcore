import { CustomResource, Duration } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
    Architecture,
    Code,
    Function as LambdaFunction,
    Runtime as LambdaRuntime,
} from "aws-cdk-lib/aws-lambda";
import { Provider } from "aws-cdk-lib/custom-resources";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";

export interface WebSearchConnectorTargetProps {
    /** Stack name base, e.g. gartner-appdev-2026. */
    stackName: string;
    /** Gateway identifier (CfnGateway.attrGatewayIdentifier). */
    gatewayId: string;
    /** Connector version to pin, e.g. "1.2.0" (adds per-request domain + date filters). */
    connectorVersion: string;
    /** Target-level domain deny-list applied to every query (hidden from the agent). */
    excludeDomains: string[];
}

/**
 * Provisions the AWS-managed Web Search Tool built-in connector as a Gateway
 * target (`connectorId: "web-search"`).
 *
 * The `connector` MCP target type is newer than the
 * `AWS::BedrockAgentCore::GatewayTarget` CloudFormation resource spec — the L1
 * construct silently drops the `connector` key, rendering `Mcp: {}` — so this
 * uses a Lambda-backed custom resource that calls `bedrock-agentcore-control`
 * `create_gateway_target` directly, the same pattern this stack already uses
 * for the Agent Registry and the Identity credential provider.
 *
 * Unlike those best-effort resources, a create failure here is authoritative
 * (it raises): when the managed connector is enabled the custom web_search
 * Lambda is not created, so a silent failure would leave the agents with no web
 * search at all. Delete is best-effort so a stack destroy is never blocked.
 */
export function createWebSearchConnectorTarget(
    scope: Construct,
    props: WebSearchConnectorTargetProps
): void {
    const { stackName, gatewayId, connectorVersion, excludeDomains } = props;
    const repoRoot = path.resolve(__dirname, "..", "..", "..");

    const fn = new LambdaFunction(scope, "WebSearchTargetProvisioner", {
        functionName: `${stackName}-web-search-target-provisioner`,
        runtime: LambdaRuntime.PYTHON_3_13,
        architecture: Architecture.ARM_64,
        handler: "handler.on_event",
        timeout: Duration.minutes(10),
        memorySize: 256,
        code: Code.fromAsset(path.join(repoRoot, "patterns", "web-search-target-cr"), {
            exclude: ["__pycache__", "*.pyc"],
            bundling: {
                image: LambdaRuntime.PYTHON_3_13.bundlingImage,
                command: [
                    "bash",
                    "-c",
                    "pip install -r requirements.txt -t /asset-output && cp -au . /asset-output",
                ],
            },
        }),
    });

    fn.addToRolePolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                "bedrock-agentcore:CreateGatewayTarget",
                "bedrock-agentcore:GetGatewayTarget",
                "bedrock-agentcore:UpdateGatewayTarget",
                "bedrock-agentcore:DeleteGatewayTarget",
                "bedrock-agentcore:ListGatewayTargets",
            ],
            resources: ["*"],
        })
    );

    const provider = new Provider(scope, "WebSearchTargetCrProvider", {
        onEventHandler: fn,
    });

    new CustomResource(scope, "WebSearchConnectorTargetResource", {
        serviceToken: provider.serviceToken,
        properties: {
            GatewayId: gatewayId,
            TargetName: "web-search-tool",
            ConnectorId: "web-search",
            ConnectorVersion: connectorVersion,
            // Stringified so a change to the list forces the custom resource to
            // re-run and reconcile the target's domain filter.
            ExcludeDomains: JSON.stringify(excludeDomains ?? []),
            HandlerVersion: "1",
        },
    });

    NagSuppressions.addResourceSuppressions(
        fn,
        [
            {
                id: "AwsSolutions-IAM5",
                reason: "Gateway target IDs are created at runtime by this custom resource; the actions are scoped to the gateway-target control-plane API.",
            },
        ],
        true
    );
    NagSuppressions.addResourceSuppressions(
        provider,
        [
            { id: "AwsSolutions-IAM4", reason: "CDK Provider framework managed role." },
            { id: "AwsSolutions-IAM5", reason: "CDK Provider framework wildcard invoke." },
            { id: "AwsSolutions-L1", reason: "CDK Provider framework manages its runtime." },
        ],
        true
    );
}
