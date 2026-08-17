import { Aws, Duration, RemovalPolicy, StackProps } from "aws-cdk-lib";
import {
    AccountRecovery,
    CfnIdentityPool,
    CfnIdentityPoolRoleAttachment,
    CfnUserPoolUser,
    FeaturePlan,
    OAuthScope,
    UserPool,
    UserPoolClient,
    UserPoolDomain,
    UserPoolGroup,
} from "aws-cdk-lib/aws-cognito";
import { Effect, FederatedPrincipal, PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import { Function } from "aws-cdk-lib/aws-lambda";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { CfnWebACL, CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
// @export {"deleteLines": 1}
import { FederateUserPool, FederateUserPoolClient } from "../common/constructs/federate";
import { Stack } from "../common/constructs/stack";
import { getAdminUserEmail, getStackNameBase } from "../common/feature-flags";
import { createManagedRules } from "../common/utilities";

interface AuthProps extends StackProps {
    urls: string[];
    hydrationFunction?: Function;
}

export class Auth extends Stack {
    public readonly userPool: UserPool;
    public readonly userPoolDomain?: UserPoolDomain;
    public readonly userPoolClient: UserPoolClient;
    public readonly identityPool: CfnIdentityPool;
    public readonly identityPoolId: string;
    public readonly regionalWebAclArn: string;
    public readonly machineClient: UserPoolClient;
    public readonly machineClientSecret: Secret;

    constructor(scope: Construct, id: string, props: AuthProps) {
        super(scope, id, props);

        const { urls, hydrationFunction } = props;
        const stackNameBase = getStackNameBase(this.node);
        const adminUserEmail = getAdminUserEmail(this.node);

        // @export {"replace": "FederateUserPool", "with": "UserPool"}
        const userPool = new FederateUserPool(this, "UserPool", {
            // @export {"replace": "false,", "with": "true,"}
            selfSignUpEnabled: false,
            signInAliases: {
                email: true,
            },
            signInPolicy: {
                allowedFirstAuthFactors: {
                    password: true,
                    emailOtp: true,
                },
            },
            autoVerify: {
                email: true,
            },
            standardAttributes: {
                email: {
                    required: false,
                    mutable: true,
                },
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireDigits: true,
                requireUppercase: true,
                requireSymbols: true,
            },
            accountRecovery: AccountRecovery.EMAIL_ONLY,
            featurePlan: FeaturePlan.ESSENTIALS,
            lambdaTriggers: {
                postConfirmation: hydrationFunction,
            },
            removalPolicy: RemovalPolicy.DESTROY,
        });
        NagSuppressions.addResourceSuppressions(userPool, [
            {
                id: "AwsSolutions-COG2",
                reason: "Cognito user pool should not require MFA for demos.",
            },
            {
                id: "AwsSolutions-COG3",
                reason: "AdvancedSecurityMode is set to depreciate. Using Cognito feature plan's essential security feature.",
            },
            {
                id: "AwsSolutions-COG8",
                reason: "Plus feature plan adds per-MAU cost for threat-protection features that are unnecessary for a short-lived demo user pool. Essentials plan provides sufficient security for the demo scope.",
            },
        ]);

        new UserPoolGroup(this, "AdminUserPoolGroup", {
            userPool,
            groupName: "Admin",
        });

        new UserPoolGroup(this, "UsersUserPoolGroup", {
            userPool,
            groupName: "Users",
        });

        const tokenValidity = Duration.hours(8);
        // @export {"replace": "FederateUserPoolClient", "with": "UserPoolClient"}
        const userPoolClient = new FederateUserPoolClient(this, "UserPoolClient", {
            userPool,
            refreshTokenValidity: tokenValidity,
            accessTokenValidity: tokenValidity,
            idTokenValidity: tokenValidity,
            authFlows: {
                userSrp: true,
                userPassword: true,
                user: true,
            },
            oAuth: {
                flows: { authorizationCodeGrant: true },
                scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
                callbackUrls: urls,
                logoutUrls: urls,
            },
        });

        // ─── M2M Resource Server for Gateway auth ─────────────────────
        const resourceServer = userPool.addResourceServer("GatewayResourceServer", {
            identifier: `${stackNameBase}-gateway`,
            scopes: [
                { scopeName: "read", scopeDescription: "Read access to gateway tools" },
                { scopeName: "write", scopeDescription: "Write access to gateway tools" },
            ],
        });

        const machineClient = userPool.addClient("MachineClient", {
            userPoolClientName: `${stackNameBase}-machine-client`,
            generateSecret: true,
            oAuth: {
                flows: { clientCredentials: true },
                scopes: [
                    OAuthScope.custom(`${stackNameBase}-gateway/read`),
                    OAuthScope.custom(`${stackNameBase}-gateway/write`),
                ],
            },
        });
        machineClient.node.addDependency(resourceServer);

        const machineClientSecret = new Secret(this, "MachineClientSecret", {
            secretName: `/${stackNameBase}/machine_client_secret`,
            description: "Machine client secret for agent-to-gateway M2M auth",
            secretStringValue: machineClient.userPoolClientSecret,
        });
        NagSuppressions.addResourceSuppressions(machineClientSecret, [
            {
                id: "AwsSolutions-SMG4",
                reason: "Secret value is a Cognito client secret managed by Cognito, not rotatable via Secrets Manager.",
            },
        ]);

        // ─── Cognito Identity Pool (for SigV4 WebSocket auth) ─────────
        const identityPool = new CfnIdentityPool(this, "IdentityPool", {
            identityPoolName: `${stackNameBase}-identity-pool`,
            allowUnauthenticatedIdentities: false,
            cognitoIdentityProviders: [
                {
                    clientId: userPoolClient.userPoolClientId,
                    providerName: userPool.userPoolProviderName,
                    serverSideTokenCheck: false,
                },
            ],
        });

        const authenticatedRole = new Role(this, "CognitoAuthenticatedRole", {
            roleName: `${stackNameBase}-cognito-authenticated`,
            assumedBy: new FederatedPrincipal(
                "cognito-identity.amazonaws.com",
                {
                    StringEquals: {
                        "cognito-identity.amazonaws.com:aud": identityPool.ref,
                    },
                    "ForAnyValue:StringLike": {
                        "cognito-identity.amazonaws.com:amr": "authenticated",
                    },
                },
                "sts:AssumeRoleWithWebIdentity"
            ),
            description: "Authenticated role for Cognito Identity Pool - allows AgentCore access",
        });

        authenticatedRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "bedrock-agentcore:InvokeAgent",
                    "bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream",
                ],
                resources: ["*"],
            })
        );
        // Read-aloud in the AI Assistant synthesizes speech with Polly's
        // generative voice directly from the browser, using the temporary
        // Identity Pool credentials. SynthesizeSpeech has no resource ARN, so
        // the resource must be "*".
        authenticatedRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["polly:SynthesizeSpeech"],
                resources: ["*"],
            })
        );
        NagSuppressions.addResourceSuppressions(
            authenticatedRole,
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "AgentCore requires wildcard resources for runtime invocation.",
                },
            ],
            true
        );

        new CfnIdentityPoolRoleAttachment(this, "IdentityPoolRoleAttachment", {
            identityPoolId: identityPool.ref,
            roles: {
                authenticated: authenticatedRole.roleArn,
            },
        });

        // ─── Optional admin user ──────────────────────────────────────
        if (adminUserEmail) {
            new CfnUserPoolUser(this, "AdminUser", {
                userPoolId: userPool.userPoolId,
                username: adminUserEmail,
                userAttributes: [
                    { name: "email", value: adminUserEmail },
                    { name: "email_verified", value: "true" },
                ],
            });
        }

        // ─── Regional WAF ─────────────────────────────────────────────
        const regionalWebAcl = new CfnWebACL(this, "RegionalWebAcl", {
            defaultAction: { allow: {} },
            scope: "REGIONAL",
            visibilityConfig: {
                metricName: "regionalWebAcl",
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
            },
            rules: [
                {
                    name: "ipRateLimitingRule",
                    priority: 0,
                    statement: {
                        rateBasedStatement: {
                            limit: 3000,
                            aggregateKeyType: "IP",
                        },
                    },
                    action: {
                        block: {},
                    },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: "ipRateLimitingRule",
                    },
                },
                ...createManagedRules("regional", 1, [
                    {
                        name: "AWSManagedRulesCommonRuleSet",
                        overrideAction: {
                            count: {},
                        },
                    },
                    {
                        name: "AWSManagedRulesBotControlRuleSet",
                        overrideAction: {
                            count: {},
                        },
                    },
                    {
                        name: "AWSManagedRulesKnownBadInputsRuleSet",
                    },
                    {
                        name: "AWSManagedRulesUnixRuleSet",
                        ruleActionOverrides: [
                            {
                                name: "UNIXShellCommandsVariables_BODY",
                                actionToUse: {
                                    count: {},
                                },
                            },
                        ],
                    },
                    {
                        name: "AWSManagedRulesSQLiRuleSet",
                        ruleActionOverrides: [
                            {
                                name: "SQLi_BODY",
                                actionToUse: {
                                    count: {},
                                },
                            },
                        ],
                    },
                ]),
            ],
        });
        const regionalWebAclArn = regionalWebAcl.attrArn;

        new CfnWebACLAssociation(this, "UserPoolWebAclAssociation", {
            resourceArn: userPool.userPoolArn,
            webAclArn: regionalWebAclArn,
        });

        // ─── User Pool Domain ─────────────────────────────────────────
        // @export {"deleteLines": 1}
        const userPoolDomain = userPool.addDomain("UserPoolDomain", {
            cognitoDomain: {
                domainPrefix: `${stackNameBase}-${Aws.ACCOUNT_ID}-${Aws.REGION}`,
            },
        });

        this.userPool = userPool;
        this.userPoolDomain = userPoolDomain;
        this.userPoolClient = userPoolClient;
        this.identityPool = identityPool;
        this.identityPoolId = identityPool.ref;
        this.regionalWebAclArn = regionalWebAclArn;
        this.machineClient = machineClient;
        this.machineClientSecret = machineClientSecret;
    }
}
