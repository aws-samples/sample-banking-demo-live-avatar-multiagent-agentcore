import {
  CognitoIdentityProviderClient,
  UpdateUserPoolClientCommand,
  DescribeUserPoolClientCommand
} from "@aws-sdk/client-cognito-identity-provider";
import fs from 'fs';

// Configure AWS credentials
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN;
const AWS_REGION = process.env.AWS_REGION;

const FRONTEND_STACKNAME = 'GenAILabs-Demo-FrontendStack'

// Initialize Cognito Identity Provider client
const cognitoClient = new CognitoIdentityProviderClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    sessionToken: AWS_SESSION_TOKEN,
  },
});
// Read the cdk-outputs.json file
fs.readFile('cdk-outputs.json', 'utf8', async (err, data) => {
  if (err) {
    console.error('Error reading cdk-outputs.json:', err);
    return;
  }

  try {
    // Parse the JSON data
    const outputs = JSON.parse(data);
    console.log(outputs);

    // Extract the relevant values from the CDK outputs
    const frontendStackOutputs = outputs[FRONTEND_STACKNAME];

    // Get the user pool client ID, user pool ID, and region from the CDK outputs
    const userPoolClientId = frontendStackOutputs['cognitoAppClientId'];
    const userPoolId = frontendStackOutputs['cognitoUserPoolId'];

    // Get the CloudFront domain from the frontend stack outputs
    const cloudFrontDomain = frontendStackOutputs['webAppURL'];

    // Get the current user pool client configuration
    const userPoolClientParams = {
      UserPoolId: userPoolId,
      ClientId: userPoolClientId,
    };

    const describeUserPoolClientCommand = new DescribeUserPoolClientCommand(userPoolClientParams);
    const userPoolClient = await cognitoClient.send(describeUserPoolClientCommand);

    const currentCallbackUrls = userPoolClient.UserPoolClient.CallbackURLs || [];
    const currentLogoutUrls = userPoolClient.UserPoolClient.LogoutURLs || [];
    const currentSupportedIdentityProviders = userPoolClient.UserPoolClient.SupportedIdentityProviders || [];
    const currentAllowedOAuthFlows = userPoolClient.UserPoolClient.AllowedOAuthFlows || [];
    const currentAllowedOAuthScopes = userPoolClient.UserPoolClient.AllowedOAuthScopes || [];

    // Append the new URLs to the existing ones
    const newCallbackUrls = [...currentCallbackUrls, `${cloudFrontDomain}`, 'https://localhost:3001'];
    const newLogoutUrls = [...currentLogoutUrls, `${cloudFrontDomain}`, 'https://localhost:3001'];

    // Update the identity providers, OAuth grant types, and OpenID Connect scopes
    const newSupportedIdentityProviders = [...currentSupportedIdentityProviders];
    const newAllowedOAuthFlows = [...currentAllowedOAuthFlows];
    const newAllowedOAuthScopes = [...currentAllowedOAuthScopes];

    // Update the user pool client with the new configuration
    const updateUserPoolClientParams = {
      UserPoolId: userPoolId,
      ClientId: userPoolClientId,
      CallbackURLs: newCallbackUrls,
      LogoutURLs: newLogoutUrls,
      SupportedIdentityProviders: newSupportedIdentityProviders,
      AllowedOAuthFlows: newAllowedOAuthFlows,
      AllowedOAuthScopes: newAllowedOAuthScopes,
      AllowedOAuthFlowsUserPoolClient: true
    };

    const command = new UpdateUserPoolClientCommand(updateUserPoolClientParams);
    const userPoolClientResponse =  await cognitoClient.send(command);

    console.log('User pool client updated successfully', userPoolClientResponse);
  } catch (error) {
    console.error('Error updating user pool client:', error);
  }
});


