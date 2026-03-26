// @export {"deleteFile": true}

import { Duration, RemovalPolicy, SecretValue, Stage } from "aws-cdk-lib";
import {
    IUserPool,
    OAuthScope,
    OidcAttributeRequestMethod,
    ProviderAttribute,
    UserPool,
    UserPoolClient,
    UserPoolClientIdentityProvider,
    UserPoolClientProps,
    UserPoolDomain,
    UserPoolDomainOptions,
    UserPoolIdentityProviderOidc,
    UserPoolOperation,
    UserPoolProps,
} from "aws-cdk-lib/aws-cognito";
import { Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import { join } from "path";

function getProfile(scope: Construct) {
    return `${Stage.of(scope)!.stageName}-${scope.node.getContext("projectId")}`;
}

function getAccountDetail(scope: Construct, detail: string) {
    return scope.node.getContext("accounts")[Stage.of(scope)!.stageName]?.[detail];
}

export class FederateUserPool extends UserPool {
    public addDomain(id: string, options?: UserPoolDomainOptions): UserPoolDomain {
        return super.addDomain(id, {
            ...options,
            cognitoDomain: { domainPrefix: getProfile(this) },
        });
    }
    constructor(scope: Construct, id: string, props: UserPoolProps) {
        super(scope, id, {
            ...props,
            removalPolicy: RemovalPolicy.DESTROY,
        });
        if (getAccountDetail(scope, "midway")) {
            const signupFunction = new NodejsFunction(this, "SignupFunction", {
                entry: join(__dirname, "signup-function.ts"),
                runtime: Runtime.NODEJS_22_X,
                architecture: Architecture.ARM_64,
                timeout: Duration.seconds(30),
            });
            signupFunction.role?.attachInlinePolicy(
                new Policy(this, "SignupFunctionPolicy", {
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                "cognito-idp:ListUsers",
                                "cognito-idp:AdminCreateUser",
                                "cognito-idp:AdminSetUserPassword",
                                "cognito-idp:AdminLinkProviderForUser",
                            ],
                            resources: [this.userPoolArn],
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ["secretsmanager:GetRandomPassword"],
                            resources: ["*"],
                        }),
                    ],
                })
            );
            this.addTrigger(UserPoolOperation.PRE_SIGN_UP, signupFunction);
        }
    }
}

export class FederateUserPoolClient extends UserPoolClient {
    constructor(scope: Construct, id: string, props: UserPoolClientProps) {
        const midway = getAccountDetail(scope, "midway");
        super(scope, id, {
            ...props,
            oAuth: {
                ...props.oAuth,
                ...(midway && {
                    scopes: [...(props.oAuth?.scopes ?? []), OAuthScope.OPENID, OAuthScope.PROFILE],
                }),
            },
            supportedIdentityProviders: [
                ...(props.supportedIdentityProviders ?? []),
                ...(midway
                    ? [
                          UserPoolClientIdentityProvider.custom(
                              new UserPoolIdentityProviderOidc(scope, "UserPoolIdentityProvider", {
                                  userPool: props.userPool as IUserPool,
                                  name: "AmazonFederate",
                                  attributeMapping: {
                                      email: ProviderAttribute.other("EMAIL"),
                                      emailVerified: ProviderAttribute.other("USER_ENABLED"),
                                  },
                                  clientId: scope.node.getContext("projectId"),
                                  clientSecret: SecretValue.secretsManager(
                                      `${getProfile(scope)}-federateSecret`
                                  ).unsafeUnwrap(),
                                  scopes: ["openid"],
                                  attributeRequestMethod: OidcAttributeRequestMethod.GET,
                                  issuerUrl: "https://idp-integ.federate.amazon.com",
                              }).providerName
                          ),
                      ]
                    : []),
            ],
        });
    }
}
