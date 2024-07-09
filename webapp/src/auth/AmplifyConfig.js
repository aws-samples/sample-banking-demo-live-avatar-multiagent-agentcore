import { Auth } from '@aws-amplify/auth'
const { cognitoAppClientId, userPoolId, backendAPIEndpoint, cognitoDomainName  } = window.frontendConfig || {}
let domainName = cognitoDomainName || 'genailabs381492099169'
const oauth = {
  domain: `${domainName}.auth.us-east-1.amazoncognito.com`,
  scope: ['openid'],
  redirectSignIn: window.location.protocol + '//' + window.location.host,
  redirectSignOut: window.location.protocol + '//' + window.location.host,
  responseType: 'code',
  options: {
    AdvancedSecurityDataCollectionFlag: false,
  },
}
export const AmplifyConfig = {
  Auth: {
    // REQUIRED - Amazon Cognito Region
    region: 'us-east-1',
    // OPTIONAL - Amazon Cognito User Pool ID
    userPoolId: userPoolId || 'us-east-1_yLe9iu9Il',
    // OPTIONAL - Amazon Cognito Web Client ID (26-char alphanumeric string)
    userPoolWebClientId: cognitoAppClientId || '792tvb07i9g6pks5fr6hincght',
    // OPTIONAL - Enforce user authentication prior to accessing AWS resources or not
    mandatorySignIn: false,
    // OPTIONAL - Configuration for cookie storage
    cookieStorage: {
      // REQUIRED - Cookie domain (only required if cookieStorage is provided)
      domain: `${window.location.hostname}`,
      // OPTIONAL - Cookie path
      path: '/',
      // OPTIONAL - Cookie expiration in days
      expires: 365,
      // OPTIONAL - Cookie secure flag
      secure: true,
    },
    oauth: oauth,
  },
  Analytics: {
    disabled: true,
  },
  API: {
    endpoints: [
      {
        name: 'demoAPI',
        endpoint: backendAPIEndpoint ?? 'https://1fe19gtxkk.execute-api.us-east-1.amazonaws.com',
        custom_header: async () => {
          return { Authorization: `${(await Auth.currentSession()).getIdToken().getJwtToken()}` }
        }
      }
    ],
  },
}