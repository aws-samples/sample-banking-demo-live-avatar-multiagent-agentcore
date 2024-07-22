# Demo Starter Kit

This project has some starter code for a webapp and backend infrastructure. It is split into two main sections

1. `cdk-stacks` - all the CDK code to deploy the front and back end.
2. `webapp`- a React web application

To kick off using the project you will need to take the following initial steps:

- Set up a midway client in https://integ.ep.federate.a2z.com/
- Store the Client Secret in the account you want to deploy into in AWS Secrets Manager as a plaintext string with the client id as the name.
- Update the variables in [cdk-stacks/stacks/infrastructure/cognito-stack.ts](./cdk-stacks/stacks/infrastructure/cognito-stack.ts). The domain must be unique.
```javascript
    const cognitoDomain = `<TODO>-${this.account.substring(0,5)}-${this.region}`
    const federateClientId = `<TODO>`
    const federateClientSecret = federateClientId
```

- Once those are complete then navigate to the cdk-stacks folder and run the deploy scripts:
```bash
cd cdk-stacks
npm run cdk:deploy
```

- Once complete ensure your cognito domain is in the Redirect URIs on your midway client (e.g. https://genai-labs-todo-demo-999999-us-east-1.auth.us-east-1.amazoncognito.com/oauth2/idpresponse)
- Look for the Cloudfront URL in your outputs and open the link, you should be logged in immediately.

- To run locally ensure frontend-config.js was copied into your webapp folder as part of the deploy (or retrieve it from the webapp S3 bucket), and then run the start command.
```bash
cd webapp
npm run start
```

- Add in your own screens and logic :D 
