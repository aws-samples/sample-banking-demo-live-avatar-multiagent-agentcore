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
    // Cognito identifier
    const cognitoIdentifier = `genailabs${this.account}`

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
      advancedSecurityMode: cognito.AdvancedSecurityMode.OFF
    });
    NagSuppressions.addResourceSuppressions(userPool, [
      {
        id: 'AwsSolutions-COG1',
        reason: 'This is the Log Bucket.'
      },
      {
        id: 'AwsSolutions-COG3',
        reason: 'This is the Log Bucket.'
      },
    ])

    // Add the OIDC identity provider
    // TODO 
    const clientSecret = secretsmanager.Secret.fromSecretNameV2(this, "ImportedSecret", `${cognitoIdentifier}`);
  
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
          client_id: cognitoIdentifier,
          client_secret: clientSecret.secretValueFromJson(cognitoIdentifier).unsafeUnwrap(),
          attributes_request_method: 'GET',
          authorize_scopes: 'openid',
          oidc_issuer: 'https://idp-integ.federate.amazon.com',
        },
      });

    // Create the User Pool client
    const userPoolClient = userPool.addClient('GenAILabsUserPoolClient', {
        userPoolClientName: `${cognitoIdentifier}client`,
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
                cognito.OAuthScope.PROFILE
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
      domain: cognitoIdentifier,
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