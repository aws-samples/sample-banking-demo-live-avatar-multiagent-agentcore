# [Demo Name]

[Summary]

## Components

Modules that are unique to a certain CDK construct or React component are colocated (in the same parent folder). Shared or generic modules are found in a "common" folder.

### Backend

![architecture](architecture.drawio.png)

`bin/app.ts` is the entrypoint to the CDK application. `lib/stacks` contains the application's stacks and child constructs.

#### [Frontend Stack](./lib/stacks/frontend/index.ts)

- The static React website is hosted in a private Amazon S3 bucket and served using Amazon CloudFront with an Origin Access Control.
- Another S3 bucket is used for storing access logs.
- A CloudFront-scoped AWS Web Application Firewall (WAF) web access control list (ACL) protects the CloudFront distribution with the following managed rules: AWSManagedRulesCommonRuleSet, AWSManagedRulesAmazonIpReputationList, and AWSManagedRulesBotControlRuleSet.

#### [Backend Stack](./lib/stacks/backend/index.ts)

##### [Auth](./lib/stacks/backend/constructs/auth.ts)

- An Amazon Cognito UserPool, UserPoolClient, and IdentityPool are used for authentication.
- A regional web ACL is created to protect Cognito and APIs.

#### [Frontend Deployment Stack](./lib/stacks/frontend/index.ts)

- Website assets are uploaded to an Amazon S3 bucket from the `app` folder.
- A CDK custom resource provider triggers an Amazon CodeBuild project which builds the React application.

### Frontend

`src/index.tsx` is the entrypoint to the React application. `src/pages` contains the application's pages and child components.

- The frontend application uses [Vite React](https://vite.dev/guide/).
- The AWS CDK-created backend resources are linked to the frontend via [Amplify.configure](./lib/stacks/frontend/app/src/App.tsx).
    - Amplify [Auth](https://docs.amplify.aws/vue/build-a-backend/auth/set-up-auth/) wraps the application, providing identity-based permissioning.

## Pricing Estimation

| AWS Service                                                     | Pricing Considerations                  | Estimated Cost (USD) |
| --------------------------------------------------------------- | --------------------------------------- | -------------------- |
| [Amazon S3](https://aws.amazon.com/s3/pricing/)                 | • Type of storage class                 | $                    |
|                                                                 | • Amount of storage per month           |                      |
|                                                                 | • Number of requests                    |                      |
|                                                                 | • Amount of data transfer out           |                      |
| [Amazon CloudFront](https://aws.amazon.com/cloudfront/pricing/) | • Amount of data transfer out by region | $                    |
|                                                                 | • Number of requests                    |                      |
|                                                                 | • Type of price class                   |                      |
| [AWS WAF](https://aws.amazon.com/waf/pricing/)                  | • Number of Web ACLs created            | $                    |
|                                                                 | • Number of rules per ACL               |                      |
|                                                                 | • Number of requests                    |                      |
| [Amazon Cognito](https://aws.amazon.com/cognito/pricing/)       | • Number of monthly active users        | $                    |
|                                                                 | • Type of pricing tier                  |                      |
|                                                                 | • Type of identity provider             |                      |
|                                                                 | • Number of SMS/email messages          |                      |
| [AWS CodeBuild](https://aws.amazon.com/codebuild/pricing/)      | • Number of build minutes               | $                    |
|                                                                 | • Type of compute                       |                      |

For more details, visit the [AWS Pricing Calculator](https://calculator.aws/#/).

## Getting Started

### Prerequisites

- Install [Node](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm), [Python](https://www.python.org/downloads/), [Docker](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-docker.html#install-docker-instructions), and the [AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_install) then complete the [prerequisites for CDK deployments](https://docs.aws.amazon.com/cdk/v2/guide/deploy.html#deploy-prerequisites) if you have not previously done so.

### Deployment

- Open a terminal and set the working directory to the location where you want to clone this repository. Clone the repository using the command `git clone [url]`.
- From the root directory, run the command `npm install` to install the [CDK](https://docs.aws.amazon.com/cdk/v2/guide/work-with-cdk-typescript.html#work-with-cdk-typescript-dependencies) and React dependencies.
- [Deploy the CDK application](https://docs.aws.amazon.com/cdk/v2/guide/deploy.html#deploy-how-deploy) using a command like `npm run cdk deploy "*/**"`.

### Accessing the Website

- Once the deployment completes, open the [CloudFormation console](https://console.aws.amazon.com/cloudformation/home?#/stacks/) then click the stack ending in **frontend**.
- Click the **Outputs** tab then the CloudFront **url** to visit the frontend app.
- **Create Account** then verify your email to access the frontend app.

## Clean-up

- Open the [CloudFormation console](https://console.aws.amazon.com/cloudformation/home) then select each stack you created and click **Delete** twice. Or use [`cdk destroy`](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-destroy.html).

## License

[Apache License Version 2.0](/LICENSE)
