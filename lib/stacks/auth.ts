import { Duration, RemovalPolicy, StackProps } from "aws-cdk-lib";
import {
    AccountRecovery,
    FeaturePlan,
    UserPool,
    UserPoolClient,
    UserPoolDomain,
    UserPoolGroup,
} from "aws-cdk-lib/aws-cognito";
import { IdentityPool, UserPoolAuthenticationProvider } from "aws-cdk-lib/aws-cognito-identitypool";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Function } from "aws-cdk-lib/aws-lambda";
import { CfnWebACL, CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
// @export {"deleteLines": 1}
import { FederateUserPool, FederateUserPoolClient } from "../common/constructs/federate";
import { Stack } from "../common/constructs/stack";
import { createManagedRules } from "../common/utilities";

interface AuthProps extends StackProps {
    urls: string[];
    hydrationFunction?: Function;
}

export class Auth extends Stack {
    public readonly userPool: UserPool;
    public readonly userPoolDomain?: UserPoolDomain;
    public readonly userPoolClient: UserPoolClient;
    public readonly identityPool: IdentityPool;
    public readonly regionalWebAclArn: string;

    constructor(scope: Construct, id: string, props: AuthProps) {
        super(scope, id, props);

        const { urls, hydrationFunction } = props;

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
                user: true,
            },
            oAuth: {
                callbackUrls: urls,
                logoutUrls: urls,
            },
        });

        const identityPool = new IdentityPool(this, "IdentityPool", {
            allowUnauthenticatedIdentities: false,
            authenticationProviders: {
                userPools: [
                    new UserPoolAuthenticationProvider({
                        userPool,
                        userPoolClient,
                    }),
                ],
            },
        });
        identityPool.unauthenticatedRole.addToPrincipalPolicy(
            new PolicyStatement({
                effect: Effect.DENY,
                actions: ["*"],
                resources: ["*"],
            })
        );

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

        this.userPool = userPool;
        // @export {"deleteLines": 1}
        this.userPoolDomain = userPool.addDomain("UserPoolDomain");
        this.userPoolClient = userPoolClient;
        this.identityPool = identityPool;
        this.regionalWebAclArn = regionalWebAclArn;
    }
}
