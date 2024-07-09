const { Authenticator } = require('cognito-at-edge');
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");

export async function handler(request) {
  try {
    // Create an SSM client
    const ssmClient = new SSMClient({ region: 'us-east-1' });

    // Fetch the Cognito configuration from the SSM Parameter Store
    const getParameterCommand = new GetParameterCommand({
      Name: '/genAiLabsDemo/cognitoConfig',
      WithDecryption: false,
    });

    console.log('Fetching Cognito configuration from SSM Parameter Store');
    const { Parameter } = await ssmClient.send(getParameterCommand);
    const cognitoConfig = JSON.parse(Parameter.Value);
    console.log('Cognito configuration fetched successfully');
    console.log(cognitoConfig);

    // Create the Authenticator instance using the values from the SSM Parameter Store
    const authenticator = new Authenticator({
      region: cognitoConfig.region,
      userPoolId: cognitoConfig.userPoolId,
      userPoolAppId: cognitoConfig.userPoolAppId,
      userPoolDomain: cognitoConfig.userPoolDomain,
    });

    console.log('Authenticating the request');
    const authenticatorResult = await authenticator.handle(request).catch(error => {
      console.error('Error authenticating the request:', error);
      throw error;
    });

    if (!authenticatorResult) {
      console.error('authenticatorResult not found');
      throw new Error('Unable to authenticate the request, please try again later');
    }

    //authenticatorResult contains tokens, not recommended to be logged
    console.log('Request authenticated successfully');
    return authenticatorResult;
  } catch (err) {
    console.error('Error handling the request:', err);
    throw err;
  }
}