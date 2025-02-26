import {
    Duration,
    StackProps,
    aws_cognito as cognito,
    aws_iam as iam,
    aws_wafv2 as waf,
} from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { LabsUserPool, LabsUserPoolClient } from "../constructs/cognito";
import { LabsStack } from "../constructs/stack";
import { createManagedRules } from "../utilities/waf";

interface AuthStackProps extends StackProps {
    urls: string[];
}

export class AuthStack extends LabsStack {
    public readonly userPool: LabsUserPool;
    public readonly userPoolClient: LabsUserPoolClient;
    public readonly identityPool: cognito.CfnIdentityPool;
    public readonly authenticatedRole: iam.Role;
    public readonly unauthenticatedRole: iam.Role;
    public readonly regionalWebAclArn: string;

    constructor(scope: Construct, id: string, props: AuthStackProps) {
        super(scope, id, props);

        this.userPool = new LabsUserPool(this, "userPool", {
            selfSignUpEnabled: false,
            signInAliases: {
                phone: false,
                email: false,
            },
            autoVerify: {
                email: true,
            },
            standardAttributes: {
                email: {
                    required: true,
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
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            featurePlan: cognito.FeaturePlan.ESSENTIALS,
        });
        NagSuppressions.addResourceSuppressions(this.userPool, [
            {
                id: "AwsSolutions-COG2",
                reason: "Cognito user pool should not require MFA when using Midway.",
            },
            {
                id: "AwsSolutions-COG3",
                reason: "AdvancedSecurityMode is set to depreciate. Using Cognito feature plan's essential security feature.",
            },
        ]);

        new cognito.UserPoolGroup(this, "adminUserPoolGroup", {
            userPool: this.userPool,
            groupName: "Admin",
        });

        new cognito.UserPoolGroup(this, "usersUserPoolGroup", {
            userPool: this.userPool,
            groupName: "Users",
        });

        this.userPoolClient = new LabsUserPoolClient(this, "userPoolClient", {
            userPool: this.userPool,
            generateSecret: false,
            refreshTokenValidity: Duration.minutes(60),
            accessTokenValidity: Duration.minutes(60),
            idTokenValidity: Duration.minutes(60),
            readAttributes: new cognito.ClientAttributes().withStandardAttributes({
                email: true,
            }),
            callbackUrls: props.urls,
        });

        this.identityPool = new cognito.CfnIdentityPool(this, "identityPool", {
            allowUnauthenticatedIdentities: false,
            cognitoIdentityProviders: [
                {
                    clientId: this.userPoolClient.userPoolClientId,
                    providerName: this.userPool.userPoolProviderName,
                },
            ],
        });

        this.authenticatedRole = new iam.Role(this, `authenticatedRole`, {
            assumedBy: new iam.FederatedPrincipal(
                "cognito-identity.amazonaws.com",
                {
                    StringEquals: {
                        "cognito-identity.amazonaws.com:aud": this.identityPool.ref,
                    },
                    "ForAnyValue:StringLike": {
                        "cognito-identity.amazonaws.com:amr": "authenticated",
                    },
                },
                "sts:AssumeRoleWithWebIdentity"
            ),
        });

        this.unauthenticatedRole = new iam.Role(this, `unauthenticatedRole`, {
            assumedBy: new iam.FederatedPrincipal(
                "cognito-identity.amazonaws.com",
                {
                    StringEquals: {
                        "cognito-identity.amazonaws.com:aud": this.identityPool.ref,
                    },
                    "ForAnyValue:StringLike": {
                        "cognito-identity.amazonaws.com:amr": "unauthenticated",
                    },
                },
                "sts:AssumeRoleWithWebIdentity"
            ),
        });
        this.unauthenticatedRole.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.DENY,
                actions: ["*"],
                resources: ["*"],
            })
        );

        new cognito.CfnIdentityPoolRoleAttachment(this, `identityPoolRoleAttachment`, {
            identityPoolId: this.identityPool.ref,
            roles: {
                authenticated: this.authenticatedRole.roleArn,
                unauthenticated: this.unauthenticatedRole.roleArn,
            },
        });

        const regionalWebAcl = new waf.CfnWebACL(this, "regionalWebAcl", {
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
                            count: {}, // override to count to bypass AWS#AWSManagedRulesCommonRuleSet#SizeRestrictions_BODY
                        },
                    },
                    {
                        name: "AWSManagedRulesBotControlRuleSet",
                        overrideAction: {
                            count: {},
                        },
                        // ruleActionOverrides: [
                        //     // allows requests from cURL and Postman to AppSync
                        //     {
                        //         actionToUse: {
                        //             count: {},
                        //         },
                        //         name: "CategoryHttpLibrary",
                        //     },
                        //     {
                        //         actionToUse: {
                        //             count: {},
                        //         },
                        //         name: "SignalNonBrowserUserAgent",
                        //     },
                        // ],
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

        this.regionalWebAclArn = regionalWebAcl.attrArn;

        new waf.CfnWebACLAssociation(this, "userPoolWebAclAssociation", {
            resourceArn: this.userPool.userPoolArn,
            webAclArn: this.regionalWebAclArn,
        });
    }
}
