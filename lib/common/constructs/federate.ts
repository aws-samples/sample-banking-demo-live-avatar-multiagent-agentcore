// @export {"deleteFile": true}

import { RemovalPolicy, SecretValue, Stage } from "aws-cdk-lib";
import {
    OAuthScope,
    OidcAttributeRequestMethod,
    ProviderAttribute,
    StringAttribute,
    UserPool,
    UserPoolClient,
    UserPoolClientIdentityProvider,
    UserPoolClientProps,
    UserPoolDomain,
    UserPoolDomainOptions,
    UserPoolIdentityProviderOidc,
    UserPoolProps,
} from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

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
            cognitoDomain: {
                domainPrefix: getProfile(this),
            },
        });
    }
    constructor(scope: Construct, id: string, props: UserPoolProps) {
        super(scope, id, {
            ...props,
            removalPolicy: RemovalPolicy.DESTROY,
            customAttributes: getAccountDetail(scope, "midway")
                ? {
                      posix: new StringAttribute({
                          mutable: true,
                      }),
                      ldap: new StringAttribute({
                          mutable: true,
                      }),
                  }
                : props.customAttributes,
        });
    }
}

export class FederateUserPoolClient extends UserPoolClient {
    constructor(scope: Construct, id: string, props: UserPoolClientProps) {
        const midway = getAccountDetail(scope, "midway");
        super(scope, id, {
            ...props,
            authFlows: midway
                ? {
                      custom: true,
                      userSrp: true,
                  }
                : props.authFlows,
            oAuth: midway
                ? {
                      flows: {
                          authorizationCodeGrant: true,
                          implicitCodeGrant: false,
                      },
                      scopes: [OAuthScope.OPENID, OAuthScope.PROFILE],
                      callbackUrls: props.oAuth?.callbackUrls,
                      logoutUrls: props.oAuth?.logoutUrls,
                  }
                : props.oAuth,
            supportedIdentityProviders: midway
                ? [
                      UserPoolClientIdentityProvider.custom(
                          new UserPoolIdentityProviderOidc(scope, "userPoolIdentityProvider", {
                              userPool: props.userPool,
                              name: "AmazonFederate",
                              attributeMapping: {
                                  email: ProviderAttribute.other("EMAIL"),
                                  custom: {
                                      "custom:posix": ProviderAttribute.other("POSIX_GROUPS"),
                                  },
                              },
                              clientId: scope.node.getContext("projectId"),
                              clientSecret: SecretValue.secretsManager(
                                  `${getProfile(scope)}-federateSecret`
                              ).unsafeUnwrap(),
                              attributeRequestMethod: OidcAttributeRequestMethod.GET,
                              issuerUrl: getAccountDetail(scope, "prod")
                                  ? "https://idp.federate.amazon.com"
                                  : "https://idp-integ.federate.amazon.com",
                          }).providerName
                      ),
                  ]
                : props.supportedIdentityProviders,
        });
    }
}
