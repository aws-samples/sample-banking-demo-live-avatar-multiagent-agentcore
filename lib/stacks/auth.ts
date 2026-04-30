import { Aws, Duration, RemovalPolicy, StackProps, Stage } from "aws-cdk-lib";
import {
    AccountRecovery,
    CfnIdentityPool,
    CfnIdentityPoolRoleAttachment,
    CfnManagedLoginBranding,
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
import * as fs from "fs";
import * as path from "path";
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
        const stageName = Stage.of(this)!.stageName;
        const isMidway = this.node.getContext("accounts")?.[stageName]?.midway === true;

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

        // ─── Managed Login Branding ───────────────────────────────────
        const bgBytes = fs.readFileSync(path.join(__dirname, "cognito-bg.jpg")).toString("base64");
        const logoBytes = fs
            .readFileSync(path.join(__dirname, "cognito-logo.png"))
            .toString("base64");

        new CfnManagedLoginBranding(this, "ManagedLoginBranding", {
            userPoolId: userPool.userPoolId,
            clientId: userPoolClient.userPoolClientId,
            useCognitoProvidedValues: false,
            returnMergedResources: true,
            assets: [
                {
                    bytes: bgBytes,
                    category: "PAGE_BACKGROUND",
                    colorMode: "DARK",
                    extension: "JPEG",
                },
                { bytes: logoBytes, category: "FORM_LOGO", colorMode: "DARK", extension: "PNG" },
            ],
            settings: {
                categories: {
                    auth: {
                        authMethodOrder: [
                            [{ display: "INPUT", type: "USERNAME_PASSWORD" }],
                            ...(isMidway
                                ? [[{ display: "BUTTON", type: "FEDERATED_SIGN_IN" }]]
                                : []),
                        ],
                    },
                    form: {
                        displayGraphics: true,
                        location: { horizontal: "CENTER", vertical: "CENTER" },
                        sessionTimerDisplay: "NONE",
                        languageSelector: { enabled: false },
                        instructions: { enabled: false },
                    },
                    global: {
                        colorSchemeMode: "DARK",
                        pageHeader: { enabled: false },
                        pageFooter: { enabled: false },
                    },
                    signUp: { acceptanceElements: [{ enforcement: "NONE", textKey: "en" }] },
                },
                componentClasses: {
                    buttons: { borderRadius: 12 },
                    divider: {
                        darkMode: { borderColor: "d4a35740" },
                        lightMode: { borderColor: "d4a35740" },
                    },
                    focusState: {
                        darkMode: { borderColor: "e88c2eff" },
                        lightMode: { borderColor: "e88c2eff" },
                    },
                    input: {
                        borderRadius: 10,
                        darkMode: {
                            defaults: { backgroundColor: "1a120a80", borderColor: "d4a35760" },
                            placeholderColor: "b89a7bff",
                        },
                        lightMode: {
                            defaults: { backgroundColor: "fffaf5cc", borderColor: "d4a35780" },
                            placeholderColor: "8b7355ff",
                        },
                    },
                    inputDescription: {
                        darkMode: { textColor: "c4a882ff" },
                        lightMode: { textColor: "6b5438ff" },
                    },
                    inputLabel: {
                        darkMode: { textColor: "f0dcc0ff" },
                        lightMode: { textColor: "3d2b14ff" },
                    },
                    link: {
                        darkMode: {
                            defaults: { textColor: "e8a642ff" },
                            hover: { textColor: "f0c878ff" },
                        },
                        lightMode: {
                            defaults: { textColor: "b87a1eff" },
                            hover: { textColor: "8b5a10ff" },
                        },
                    },
                    optionControls: {
                        darkMode: {
                            defaults: { backgroundColor: "1a120aff", borderColor: "d4a35780" },
                            selected: { backgroundColor: "e88c2eff", foregroundColor: "ffffffff" },
                        },
                        lightMode: {
                            defaults: { backgroundColor: "fffaf5ff", borderColor: "d4a35780" },
                            selected: { backgroundColor: "e88c2eff", foregroundColor: "ffffffff" },
                        },
                    },
                    statusIndicator: {
                        darkMode: {
                            error: {
                                backgroundColor: "2a0a0aff",
                                borderColor: "eb6f6fff",
                                indicatorColor: "eb6f6fff",
                            },
                            pending: { indicatorColor: "d4a357ff" },
                            success: {
                                backgroundColor: "0a1a0aff",
                                borderColor: "4caf50ff",
                                indicatorColor: "4caf50ff",
                            },
                            warning: {
                                backgroundColor: "2a1a0aff",
                                borderColor: "e8a642ff",
                                indicatorColor: "e8a642ff",
                            },
                        },
                        lightMode: {
                            error: {
                                backgroundColor: "fff0f0ff",
                                borderColor: "d91515ff",
                                indicatorColor: "d91515ff",
                            },
                            pending: { indicatorColor: "d4a357ff" },
                            success: {
                                backgroundColor: "f0fff0ff",
                                borderColor: "2e7d32ff",
                                indicatorColor: "2e7d32ff",
                            },
                            warning: {
                                backgroundColor: "fff8f0ff",
                                borderColor: "e88c2eff",
                                indicatorColor: "e88c2eff",
                            },
                        },
                    },
                },
                components: {
                    alert: {
                        borderRadius: 12,
                        darkMode: {
                            error: { backgroundColor: "2a0a0aff", borderColor: "eb6f6fff" },
                        },
                        lightMode: {
                            error: { backgroundColor: "fff0f0ff", borderColor: "d91515ff" },
                        },
                    },
                    form: {
                        backgroundImage: { enabled: false },
                        borderRadius: 16,
                        darkMode: { backgroundColor: "1a120ae0", borderColor: "d4a35740" },
                        lightMode: { backgroundColor: "ffffffe0", borderColor: "d4a35740" },
                        logo: {
                            enabled: true,
                            formInclusion: "IN",
                            location: "CENTER",
                            position: "TOP",
                        },
                    },
                    pageBackground: {
                        darkMode: { color: "1a0f05ff" },
                        image: { enabled: true },
                        lightMode: { color: "faf5eeff" },
                    },
                    pageHeader: {
                        backgroundImage: { enabled: false },
                        darkMode: { background: { color: "00000000" }, borderColor: "00000000" },
                        lightMode: { background: { color: "00000000" }, borderColor: "00000000" },
                        logo: { enabled: false, location: "START" },
                    },
                    pageFooter: {
                        backgroundImage: { enabled: false },
                        darkMode: { background: { color: "00000000" }, borderColor: "00000000" },
                        lightMode: { background: { color: "00000000" }, borderColor: "00000000" },
                        logo: { enabled: false, location: "START" },
                    },
                    pageText: {
                        darkMode: {
                            bodyColor: "c4a882ff",
                            descriptionColor: "c4a882ff",
                            headingColor: "f0dcc0ff",
                        },
                        lightMode: {
                            bodyColor: "6b5438ff",
                            descriptionColor: "6b5438ff",
                            headingColor: "3d2b14ff",
                        },
                    },
                    primaryButton: {
                        darkMode: {
                            active: { backgroundColor: "c97a20ff", textColor: "ffffffff" },
                            defaults: { backgroundColor: "e88c2eff", textColor: "ffffffff" },
                            hover: { backgroundColor: "f0a040ff", textColor: "ffffffff" },
                        },
                        lightMode: {
                            active: { backgroundColor: "c97a20ff", textColor: "ffffffff" },
                            defaults: { backgroundColor: "e88c2eff", textColor: "ffffffff" },
                            hover: { backgroundColor: "f0a040ff", textColor: "ffffffff" },
                        },
                    },
                    secondaryButton: {
                        darkMode: {
                            active: {
                                backgroundColor: "d4a35720",
                                borderColor: "e88c2eff",
                                textColor: "e88c2eff",
                            },
                            defaults: {
                                backgroundColor: "00000000",
                                borderColor: "d4a35780",
                                textColor: "e8a642ff",
                            },
                            hover: {
                                backgroundColor: "d4a35710",
                                borderColor: "e88c2eff",
                                textColor: "f0c878ff",
                            },
                        },
                        lightMode: {
                            active: {
                                backgroundColor: "d4a35720",
                                borderColor: "b87a1eff",
                                textColor: "b87a1eff",
                            },
                            defaults: {
                                backgroundColor: "00000000",
                                borderColor: "d4a35780",
                                textColor: "b87a1eff",
                            },
                            hover: {
                                backgroundColor: "d4a35710",
                                borderColor: "b87a1eff",
                                textColor: "8b5a10ff",
                            },
                        },
                    },
                },
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
