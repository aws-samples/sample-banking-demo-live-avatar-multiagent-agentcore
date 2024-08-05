import { NestedStack, NestedStackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { NagSuppressions } from 'cdk-nag';

export interface CognitoStackProps extends NestedStackProps {
  readonly cdkAppName: string;
}

export class CognitoStack extends NestedStack {
  public readonly userPool: cognito.IUserPool;
  public readonly userPoolClient: cognito.IUserPoolClient;
  public readonly userPoolDomain: cognito.CfnUserPoolDomain;

  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);
    // TODO UPDATE configuration to figure out if environment is production
    const isProduction = false;

    // TODO UPDATE THESE TO YOUR VALUES
    const cognitoDomain = `<TODO>-${this.account.substring(0,5)}-${this.region}`
    const federateClientId = `<TODO>`
    const federateClientSecretName = federateClientId
    // TODO MAKE SURE TO UPDATE THIS TO PROD FEDERATE WHEN MOVING OUT OF INITIAL DEV
    const oidc_issuer = isProduction ? 'https://idp.federate.amazon.com' : 'https://idp-integ.federate.amazon.com';


    // Create a User Pool
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${props.cdkAppName}-${this.account}-UserPool`,
      removalPolicy: RemovalPolicy.DESTROY,
      selfSignUpEnabled: false,
      signInAliases: {
        username: true,
        phone: false,
        email: false
      },
      standardAttributes: {
        email: {
          required: true,   //Cognito bug with federation - If you make a user pool with required email field then the second google login attempt fails (https://github.com/aws-amplify/amplify-js/issues/3526)
          mutable: true
        }
      },
      // Add custom attributes for Amazon Federate
      customAttributes: {
        posix: new cognito.StringAttribute({mutable: true }),
        ldap: new cognito.StringAttribute({ mutable: true }),
      },
      advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED,
      passwordPolicy:{
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(7),
      },
    });

    // Add the OIDC identity provider
    const clientSecret = secretsmanager.Secret.fromSecretNameV2(this, "ImportedSecret", `${federateClientSecretName}`);

    const oidcProvider = new cognito.CfnUserPoolIdentityProvider(this, 'UserPoolIdentityProvider', {
        userPoolId: userPool.userPoolId,
        providerType: 'OIDC',
        providerName: 'AmazonFederate',
        attributeMapping: {
          email: 'EMAIL',
          username: 'sub',
          name: 'GECOS',
          'custom:posix': 'POSIX_GROUPS'
        },
        providerDetails: {
          client_id: federateClientId,
          client_secret: clientSecret.secretValue.unsafeUnwrap(),
          attributes_request_method: 'GET',
          authorize_scopes: 'openid',
          oidc_issuer: oidc_issuer,
        },
      });

    // Create the User Pool client
    const userPoolClient = userPool.addClient('GenAILabsUserPoolClient', {
        userPoolClientName: `${federateClientId}-client`,
        generateSecret: false,
        refreshTokenValidity: Duration.minutes(60),
        authFlows: {
            userSrp: true,
            custom: true
        },
        oAuth: {
            flows: {
                authorizationCodeGrant: true,
                implicitCodeGrant: false
            },
            scopes: [
              cognito.OAuthScope.OPENID,
              cognito.OAuthScope.PROFILE,
              cognito.OAuthScope.COGNITO_ADMIN
            ],
            callbackUrls: ['https://<PLACEHOLDER>.cloudfront.net/oauth2/idpresponse'],
            logoutUrls: ['https://<PLACEHOLDER>.cloudfront.net/logout'],
            },
        supportedIdentityProviders: [
            cognito.UserPoolClientIdentityProvider.custom(oidcProvider.providerName)
            ],
    });

    userPoolClient.node.addDependency(oidcProvider);

    const userPoolDomain = new cognito.CfnUserPoolDomain(this, 'UserPoolDomain', {
      domain: cognitoDomain,
      userPoolId: userPool.userPoolId,
    });

    // Store Cognito variables in SSM for Lambda@Edge (it doesn't support env variables)
     const cognitoConfig = JSON.stringify({
      'region': this.region,
      'userPoolId': userPool.userPoolId,
      'userPoolAppId': userPoolClient.userPoolClientId,
      'userPoolDomain': `${userPoolDomain.domain}.auth.us-east-1.amazoncognito.com`
    });

    // Create an SSM string parameter
    new ssm.StringParameter(this, 'CognitoConfig', {
      parameterName: '/genAiLabs/demoPortal/cognitoConfig',
      stringValue: cognitoConfig
    });

    // Stack Outputs
    this.userPool = userPool;
    this.userPoolClient = userPoolClient;
    this.userPoolDomain = userPoolDomain;
  }
}