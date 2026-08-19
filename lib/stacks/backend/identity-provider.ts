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

export interface IdentityProviderProps {
    /** Stack name base, e.g. gartner-appdev-2026. */
    stackName: string;
    /** Cognito user-pool OIDC discovery URL (issuer + /.well-known/openid-configuration). */
    discoveryUrl: string;
    /** SSM parameter name holding the machine client id. */
    clientIdParam: string;
    /** Secrets Manager secret NAME holding the machine client secret. */
    clientSecretName: string;
    /** Secret ARN, for the read grant. */
    clientSecretArn: string;
}

/**
 * AgentCore Identity OAuth2 credential provider for the Gateway's Cognito M2M
 * client (features.agentcore_identity).
 *
 * No CloudFormation resource exists for Identity credential providers, so a
 * Lambda-backed custom resource (patterns/identity-provider-cr) creates one via
 * the `bedrock-agentcore-control` API. The provider holds the machine-client
 * credentials in the Identity token vault; agents then mint Gateway tokens
 * through Identity (GetWorkloadAccessToken → GetResourceOauth2Token) instead of
 * calling Cognito directly. The resulting bearer is the same Cognito JWT the
 * Gateway already accepts, so nothing downstream changes.
 */
export function createIdentityProvider(
    scope: Construct,
    props: IdentityProviderProps
): { providerName: string } {
    const { stackName, discoveryUrl, clientIdParam, clientSecretName, clientSecretArn } = props;
    const repoRoot = path.resolve(__dirname, "..", "..", "..");
    // Provider name pattern is [a-zA-Z0-9\-_]+.
    const providerName = `${stackName.replace(/[^a-zA-Z0-9\-_]/g, "-")}-gateway-m2m`;

    const fn = new LambdaFunction(scope, "IdentityProviderProvisioner", {
        functionName: `${stackName}-identity-provider-provisioner`,
        runtime: LambdaRuntime.PYTHON_3_13,
        architecture: Architecture.ARM_64,
        handler: "handler.on_event",
        timeout: Duration.minutes(5),
        memorySize: 256,
        code: Code.fromAsset(path.join(repoRoot, "patterns", "identity-provider-cr"), {
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
                "bedrock-agentcore:CreateOauth2CredentialProvider",
                "bedrock-agentcore:GetOauth2CredentialProvider",
                "bedrock-agentcore:ListOauth2CredentialProviders",
                "bedrock-agentcore:UpdateOauth2CredentialProvider",
                "bedrock-agentcore:DeleteOauth2CredentialProvider",
                // Creating the FIRST credential provider in an account lazily
                // creates the default token vault, so the control-plane call
                // authorizes CreateTokenVault/GetTokenVault on the caller.
                "bedrock-agentcore:CreateTokenVault",
                "bedrock-agentcore:GetTokenVault",
                // The token vault is backed by service-managed Secrets Manager
                // secrets in this account; the control-plane calls need these on
                // the vault-prefixed secrets it creates on the caller's behalf.
                "secretsmanager:CreateSecret",
                "secretsmanager:PutSecretValue",
                "secretsmanager:DeleteSecret",
                "secretsmanager:GetSecretValue",
                "secretsmanager:TagResource",
                "secretsmanager:UpdateSecret",
            ],
            resources: ["*"],
        })
    );
    fn.addToRolePolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["ssm:GetParameter"],
            resources: ["*"],
        })
    );
    fn.addToRolePolicy(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["secretsmanager:GetSecretValue"],
            resources: [clientSecretArn],
        })
    );

    const provider = new Provider(scope, "IdentityProviderCrProvider", {
        onEventHandler: fn,
    });

    new CustomResource(scope, "IdentityProviderResource", {
        serviceToken: provider.serviceToken,
        properties: {
            ProviderName: providerName,
            DiscoveryUrl: discoveryUrl,
            ClientIdParam: clientIdParam,
            ClientSecretName: clientSecretName,
            // Bump to force the custom resource to re-run when the handler's
            // IAM policy or behavior changes (properties are otherwise stable).
            HandlerVersion: "2",
        },
    });

    NagSuppressions.addResourceSuppressions(
        fn,
        [
            {
                id: "AwsSolutions-IAM5",
                reason: "Identity provider ARNs and token-vault secrets are created at runtime by this custom resource; SSM read is name-based.",
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

    return { providerName };
}
