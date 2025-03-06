# Infrastructure

![architecture](./images/architecture.png)

- The static website is hosted in Amazon S3 and served using Amazon CloudFront.
    - The website bucket hosts HTML, CSS, JavaScript, and other static assets.
- Web authentication is handled by Amazon Cognito through AWS Amplify Authentication.
    - Amazon Cognito Integrates with Amazon Federate for Midway OIDC authentication.
- AWS Web Application Firewall (WAF) protects both the Amazon CloudFront distribution, Cognito UserPool, API Gateway REST API, and AWS AppSync GraphQL API.
- AWS Certificate Manager is used to provide HTTPS support to all Amazon CloudFront calls for superior encryption in transit.
- The AWS Amplify GraphQL contruct tighly integrates Amazon AppSync, DynamoDB, and AWS Lambda resolvers.
- An Amazon API Gateway Lambda proxy integration, alongside Powertools for AWS Lambda, is used to enable the quick creation of new API routes without managing additional infrastructure.
- An Amazon S3 bucket is used to store other demo assets like images, videos, synthetic data, etc.
- Another Amazon S3 bucket is used as a Knowledge Base source, with a Knowledge Base construct simplifying GenAI infrastructure management.
- A VPC stack provides optional Lambda integration and network security with Gateway and Interface endpoints.
- A frontend deploy stack is used to deploy the React frontend.

See our [design documentation](./design.md) to learn more about starter kit-specific constructs.
