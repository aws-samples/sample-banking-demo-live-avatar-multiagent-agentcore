import { RemovalPolicy, Stack } from "aws-cdk-lib";
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
    UserPoolIdentityProviderOidc,
    UserPoolProps,
} from "aws-cdk-lib/aws-cognito";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { PresetStageType, projectConfig } from "../../../../config";

function getMidwaySecretId(scope: Construct): string | undefined {
    return projectConfig?.midway
        ? Object.values(projectConfig.accounts).find(
              (account) => account.number === Stack.of(scope).account
          )?.midwaySecretId
        : undefined;
}

export class LabsUserPool extends UserPool {
    private readonly userPoolDomain: UserPoolDomain;
    public readonly userPoolDomainUrl: string;
    constructor(
        scope: Construct,
        id: string,
        props: Omit<UserPoolProps, "removalPolicy" | "customAttributes">
    ) {
        super(scope, id, {
            ...props,
            removalPolicy: RemovalPolicy.DESTROY, // when using midway, we do not want to retain this user pool
            customAttributes: getMidwaySecretId(scope)
                ? {
                      posix: new StringAttribute({
                          mutable: true,
                      }),
                      ldap: new StringAttribute({
                          mutable: true,
                      }),
                  }
                : undefined,
        });
        this.userPoolDomain = this.addDomain("userPoolDomain", {
            cognitoDomain: {
                domainPrefix: `${projectConfig.projectId}-${Stack.of(scope).account}`,
            },
        });
        this.userPoolDomainUrl = this.userPoolDomain.baseUrl().replace("https://", "");
    }
}

export class LabsUserPoolClient extends UserPoolClient {
    constructor(
        scope: Construct,
        id: string,
        props: Omit<UserPoolClientProps, "authFlows" | "oAuth" | "supportedIdentityProviders"> & {
            callbackUrls: string[];
        }
    ) {
        const midwaySecretId = getMidwaySecretId(scope);
        super(scope, id, {
            ...props,
            authFlows: midwaySecretId
                ? {
                      custom: true,
                      userSrp: true,
                  }
                : {
                      adminUserPassword: true,
                      custom: true,
                      userSrp: true,
                  },
            oAuth: midwaySecretId
                ? {
                      flows: {
                          authorizationCodeGrant: true,
                          implicitCodeGrant: false,
                      },
                      scopes: [OAuthScope.OPENID, OAuthScope.PROFILE],
                      callbackUrls: props.callbackUrls,
                      logoutUrls: props.callbackUrls,
                  }
                : undefined,
            supportedIdentityProviders: midwaySecretId
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
                              clientId: projectConfig.projectId,
                              clientSecret: Secret.fromSecretCompleteArn(
                                  scope,
                                  "midwaySecret",
                                  `arn:aws:secretsmanager:${Stack.of(scope).region}:${Stack.of(scope).account}:secret:${
                                      projectConfig.projectId
                                  }-midway-secret-${midwaySecretId}`
                              )
                                  .secretValueFromJson("clientID")
                                  .unsafeUnwrap(),
                              attributeRequestMethod: OidcAttributeRequestMethod.GET,
                              issuerUrl:
                                  Stack.of(scope).account ===
                                  projectConfig.accounts[PresetStageType.Prod]?.number
                                      ? "https://idp.federate.amazon.com"
                                      : "https://idp-integ.federate.amazon.com",
                          }).providerName
                      ),
                  ]
                : undefined,
        });
    }
}
