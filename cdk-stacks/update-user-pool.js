const AWS = require('aws-sdk');
const fs = require('fs');

// Configure AWS credentials
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
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

    // Extract the relevant values from the CDK outputs
    const frontendStackOutputs = outputs['GenAILabs-Demo-FrontendStack'];

    // Get the user pool client ID, user pool ID, and region from the CDK outputs
    const userPoolClientId = frontendStackOutputs['cognitoAppClientId'];
    const userPoolId = frontendStackOutputs['cognitoUserPoolId'];

    // Get the CloudFront domain from the frontend stack outputs
    const cloudFrontDomain = frontendStackOutputs['webAppURL'];

    // Create a Cognito client with the region from the CDK outputs
    const cognito = new AWS.CognitoIdentityServiceProvider({ region: 'us-east-1' });

    // Get the current user pool client configuration
    const userPoolClientParams = {
      UserPoolId: userPoolId,
      ClientId: userPoolClientId,
    };

    const userPoolClient = await cognito.describeUserPoolClient(userPoolClientParams).promise();

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

    const userPoolClientResponse = await cognito.updateUserPoolClient(updateUserPoolClientParams).promise();

    console.log('User pool client updated successfully', userPoolClientResponse);
  } catch (error) {
    console.error('Error updating user pool client:', error);
  }
});