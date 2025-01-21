import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Construct } from 'constructs';
import { CDKProps } from "../config/AppConfig";
import { AccountRecovery, CfnIdentityPool, CfnIdentityPoolRoleAttachment, CfnUserPoolDomain, CfnUserPoolGroup, CfnUserPoolIdentityProvider, ClientAttributes, FeaturePlan, OAuthScope, StringAttribute, UserPool, UserPoolClient, UserPoolClientIdentityProvider } from "aws-cdk-lib/aws-cognito";
import { Role, FederatedPrincipal, Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { PresetStageType } from "../shared";
import { NagSuppressions } from "cdk-nag";


interface AuthStackProps extends CDKProps {
    regionalWebAclArn: string;
    distributionDomainName: string;
    midwaySecretID?: string
}

export class AuthStack extends Stack {
    public readonly userPool: UserPool;
    public readonly userPoolClient: UserPoolClient;
    public readonly identityPool: CfnIdentityPool;
    public readonly authenticatedRole: Role;
    public readonly unauthenticatedRole: Role;
    public readonly identityPoolRoleAttachment: CfnIdentityPoolRoleAttachment;

    private oidcProvider: cdk.aws_cognito.CfnUserPoolIdentityProvider
    private userPoolDomain: cdk.aws_cognito.CfnUserPoolDomain

    constructor(scope: Construct, id: string, props: AuthStackProps) {
        super(scope, id, props);

        this.userPool = new UserPool(this, `${props.projectName}-user-pool`, {
            userPoolName: `${props.projectName}-user-pool`,
            selfSignUpEnabled: false, // avoid new users from signing up via webapp ui
            signInAliases: {
                phone: false,
                email: false
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

            removalPolicy: RemovalPolicy.DESTROY, // since its midway authed users we do not want to retain this user-pool upo stack deletion/updates
            featurePlan: FeaturePlan.ESSENTIALS, // https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html
            // set up custom attributes only if midway auth is selected 
            customAttributes: props.midwaySecretID ? {
                posix: new StringAttribute({ mutable: true }),
                ldap: new StringAttribute({ mutable: true }),
            } : undefined
        });

        NagSuppressions.addResourceSuppressions(
            this.userPool,
            [
                {
                    id: "AwsSolutions-COG3",
                    reason: "AdvancedSecurityMode is set to depreciate. Using Cognito Feature Plans to subscribe for Essential security feature.",
                },
            ])

        // create Admin group
        new CfnUserPoolGroup(this, `${props.projectName}-admin-group`, {
            userPoolId: this.userPool.userPoolId,
            groupName: "Admin",
            description: "Admin Group",
        });
        // create Users group
        new CfnUserPoolGroup(this, `${props.projectName}-user-group`, {
            userPoolId: this.userPool.userPoolId,
            groupName: "Users",
            description: "Users Group",
        });


        if (props.midwaySecretID) {
            // import client secret from secrets manager using partial ARN
            const clientSecret = Secret.fromSecretCompleteArn(this, `${props.projectName}-midway-secret`, `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${props.projectName}-midway-secret-${props.midwaySecretID}`)

            this.oidcProvider = new CfnUserPoolIdentityProvider(this, 'UserPoolIdentityProvider', {
                userPoolId: this.userPool.userPoolId,
                providerType: 'OIDC',
                providerName: 'AmazonFederate',
                attributeMapping: {
                    email: 'EMAIL',
                    username: 'sub',
                    name: 'GECOS',
                    'custom:posix': 'POSIX_GROUPS'
                },
                providerDetails: {
                    client_id: props.projectName,
                    client_secret: clientSecret.secretValueFromJson("clientID").unsafeUnwrap(),
                    attributes_request_method: 'GET',
                    authorize_scopes: 'openid',
                    oidc_issuer: props.accountName === PresetStageType.Prod ? 'https://idp.federate.amazon.com' : 'https://idp-integ.federate.amazon.com',
                },
            });
        }


        // User Pool Client
        const callbackUrls = [`https://${props.distributionDomainName}`, "http://localhost:3000"];

        this.userPoolClient = new UserPoolClient(this, `${props.projectName}-user-pool-client`, {
            userPool: this.userPool,
            userPoolClientName: `${props.projectName}-client`,
            generateSecret: false,
            refreshTokenValidity: Duration.minutes(60),
            accessTokenValidity: cdk.Duration.minutes(60),
            idTokenValidity: cdk.Duration.minutes(60),
            authFlows: props.midwaySecretID ? {
                custom: true,
                userSrp: true,
            } : {
                adminUserPassword: true,
                custom: true,
                userSrp: true,
            },
            oAuth: props.midwaySecretID ? {
                flows: {
                    authorizationCodeGrant: true,
                    implicitCodeGrant: false,
                },
                scopes: [
                    OAuthScope.OPENID,
                    OAuthScope.PROFILE
                ],
                callbackUrls: callbackUrls,
                logoutUrls: callbackUrls,
            } : undefined,
            supportedIdentityProviders: props.midwaySecretID ? [
                // add providers 
                UserPoolClientIdentityProvider.custom(this.oidcProvider.providerName),
            ] : undefined,
            readAttributes: new ClientAttributes().withStandardAttributes({
                email: true,
            }),
        });

        if (props.midwaySecretID) {
            // add a dependency so CDK does sequential deployments 
            this.userPoolClient.node.addDependency(this.oidcProvider);
            this.userPoolDomain = new CfnUserPoolDomain(this, 'UserPoolDomain', {
                domain: `${props.projectName}-${this.account}`,
                userPoolId: this.userPool.userPoolId,
            });
        }


        // identity pool
        this.identityPool = new CfnIdentityPool(this, `${props.projectName}-identity-pool`, {
            identityPoolName: `${props.projectName}-identity-pool`,
            allowUnauthenticatedIdentities: false,
            cognitoIdentityProviders: [
                {
                    clientId: this.userPoolClient.userPoolClientId,
                    providerName: this.userPool.userPoolProviderName,
                },
            ],
        });


        // Role associated with authenticated users
        this.authenticatedRole = new Role(this, `AuthenticatedRole`, {
            assumedBy: new FederatedPrincipal(
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


        // Role associated with unauthenticated users
        this.unauthenticatedRole = new Role(this, `UnauthenticatedRole`, {
            assumedBy: new FederatedPrincipal(
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



        // explicitly deny all access for unauth role 
        this.unauthenticatedRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.DENY,
                actions: ["*"],
                resources: ["*"],
            })
        );

        // Attach the unauthenticated and authenticated roles to the identity pool
        this.identityPoolRoleAttachment = new CfnIdentityPoolRoleAttachment(
            this,
            `RoleAttachment`,
            {
                identityPoolId: this.identityPool.ref,
                roles: {
                    authenticated: this.authenticatedRole.roleArn,
                    unauthenticated: this.unauthenticatedRole.roleArn,
                },
            }
        );

        // associate the regional WAF to AWS Cognito 
        new CfnWebACLAssociation(this, `${props.projectName}-webacl-cognito-association`, {
            resourceArn: this.userPool.userPoolArn,
            webAclArn: props.regionalWebAclArn,
        });


        // Cognito resource  Outputs
        new cdk.CfnOutput(this, 'config-cognito-identitypool-id', {
            value: this.identityPool.ref,
            description: "identity pool id",
            exportName: `${props.projectName}-config-cognito-identitypool-id`,
        });

        new cdk.CfnOutput(this, "config-cognito-userpool-id", {
            value: this.userPool.userPoolId,
            description: "user pool id",
            exportName: `${props.projectName}-config-cognito-userpool-id`,
        });

        new cdk.CfnOutput(this, "config-cognito-appclient-id", {
            value: this.userPoolClient.userPoolClientId,
            description: "app client id",
            exportName: `${props.projectName}-config-cognito-appclient-id`,
        });




        new cdk.CfnOutput(this, "config-cognito-callback-url", {
            value: callbackUrls[0],
            description: "callback url",
            exportName: `${props.projectName}-config-cognito-callback-url`,
        });

        new cdk.CfnOutput(this, "config-cognito-logout-url-output", {
            value: callbackUrls[0],
            description: "logout url",
            exportName: `${props.projectName}-config-cognito-logout-url`,
        });

        if (props.midwaySecretID) {
            new cdk.CfnOutput(this, "config-cognito-domain", {
                value: `${this.userPoolDomain.domain}.auth.${this.region}.amazoncognito.com`,
                description: "Oauth domain name",
                exportName: `${props.projectName}-config-cognito-domain`,
            });
        }

    }
}