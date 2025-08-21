<!-- @export {"id": "kit", "deleteFile": true} -->

# Technical Product Marketing Demo Guidelines

A comprehensive, end-to-end guide to architect, build, deploy, and operate AWS Technical Marketing demos. Follow these standards to ensure consistency, scalability, security, and maintainability for our team. If you have any questions about the guidance mentioned, then please contact your Technical Product Marketing Bar Raiser.

---

## Technical Guidance

In order to get you started, the Technical Product Marketing Team has created a [Demo Starter Kit](https://gitlab.aws.dev/genai-labs/templates/demo-starter-kit) which includes ready-to-deploy, compliant and secure CDK stacks and React app components with Midway integration. It also includes a set of customizable CLI tooling for demo configuration and management. You retain the freedom to customize any and all aspects of the kit to fit your use case. The kit also includes an export script, allowing you to share it with outside/third-party agencies.

- [ ] Uses the Starter Kit.

### Repository, Version Control, and Asset Management

- [ ] Repo is not public facing.
- [ ] Stores all digital assets related to the demo in a monorepository (code, images, videos, PowerPoints, etc.)

### Coding Guidelines

- [ ] Adheres to KISS (Keep it simple...):
    - [ ] Keeps single sources of truth for data, logic, etc.
    - [ ] Only uses single-use variables/functions when necessary for clarity.
    - [ ] Logical units of code are broken down into clearly named, appropriately co-located/nested components.
- [ ] Adheres to DRY (Don’t repeat yourself):
    - [ ] Generic code is not be duplicated. Shared generic components are in a common folder.
        - Some duplication is tolerable, particularly for complex logic with varying inputs. Modifying a shared component on behalf of one component shouldn’t risk breaking others.

- [ ] Adheres to YAGNI (You aren’t gonna need it):
    - [ ] Unused variables, functions, logic, etc. aren’t committed to the main branch.
- [ ] Implements proper exception handling, validates inputs, and provides meaningful error messages for debugging and user experience.
- [ ] LLM prompts and other bulk language is read from text or json files.

#### Distribution and Deployment

- [ ] Code has no regional dependencies unless dictated by service availability/quotas.
- [ ] Project is self-contained and does not reach out to external resources like public S3 buckets.
- [ ] Code fully deploys and destroys with the standard [CDK commands](https://docs.aws.amazon.com/cdk/v2/guide/cli.html#cli-deploy).

#### Documentation

- [ ] Code has comments for complex logic, an up-to-date README, and well-documented APIs.
- [ ] Has pricing info for each of the AWS services used.

### Tech Stack and Patterns

- [ ] Demo uses the actual technologies they are showcasing (ex: AgentCore for Multi-Agent demos).

#### Infrastructure and Backend

- [ ] Uses [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/home.html) in Typescript for Infrastructure as Code (IaC), following [best practices](https://docs.aws.amazon.com/prescriptive-guidance/latest/best-practices-cdk-typescript-iac/introduction.html).
    - [ ] Code is organized into logical units (ex: `Auth`, `Storage`, `API`, `Database`), [implemented as constructs, deployed with stacks](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html#best-practices-constructs).
    - [ ] Leverages abstracted [L2/L3 constructs](https://docs.aws.amazon.com/cdk/v2/guide/constructs.html#constructs-lib-levels) from `aws-cdk-lib` and `[generative-ai-cdk-constructs](https://github.com/awslabs/generative-ai-cdk-constructs)` over L1/CloudFormation resources.
    - [ ] Uses [CDK grant](https://docs.aws.amazon.com/cdk/v2/guide/permissions.html#permissions-grants) functionality over written IAM policies.
    - [ ] Leverages [CDK Aspects](https://docs.aws.amazon.com/cdk/v2/guide/aspects.html) to apply consistent logging, retention, and other policies.
    - [ ] Leverages CDK constructs like `(from)`[_`DockerImageAsset`_](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecr_assets.DockerImageAsset.html), [`PythonFunction`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-lambda-python-alpha-readme.html), and [_`NodejsFunction`_](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.NodejsFunction.html) for runtime code and [`BucketDeployment`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment.BucketDeployment.html) for asset deployment/management.
- [ ] Uses Typescript Node and/or Python for runtime code.
    - [ ] Leverages functionality of AWS open-source libraries like [Powertools](https://docs.powertools.aws.dev/lambda/python/latest/), [aws-lambda](https://www.npmjs.com/package/@types/aws-lambda), and [aws-appsync](https://github.com/awslabs/aws-mobile-appsync-sdk-js).
- [ ] Leverages Graviton and serverless technologies to the fullest extent possible for scale and cost-efficiency.
- [ ] Sets up logging and alerts (through CDK).
    - [ ] Tracks metrics like demo runs per user/event.

#### Frontend

- [ ] Uses one of the following frontend frameworks/language:
    - **For New Apps:** Vite + React + TypeScript
        - [ ] Uses React Router
        - [ ] Hosted in Amazon S3/CloudFront

    - **For Existing SSR Apps:** Next.js + TypeScript
        - [ ] Hosted in AWS Amplify
            - Waiting for Amplify Hosting to support manual/S3 deployments for SSR apps.

- [ ] Uses Atomic CSS libraries or Tailwind for styling.
- [ ] Uses React Context, Jotai, or Zustand for state management.
- [ ] Uses [Amplify](https://docs.amplify.aws/react/build-a-backend/) libraries for (Amazon Cognito) authentication, api/storage requests, etc.
- [ ] Uses established UI libraries like [Cloudscape](https://cloudscape.design/) or [Material UI](https://mui.com/material-ui/).

#### Developer Tooling

- Package management
    - [Volta](https://volta.sh/)/NPM for Node/React.
    - [uv](https://docs.astral.sh/uv/#tools)/Pip for Python.

* [ ] Uses linting to maintain code quality.
    - [ESLint](https://eslint.org/) for Typescript.
    - [Ruff](https://docs.astral.sh/ruff/) for Python.

* [ ] Enforces code formatting.
    - [Ruff](https://docs.astral.sh/ruff/) for Python.
    - [Prettier](https://prettier.io/) for everything else.

#### Testing (As Necessary)

- [ ] Uses `[cdk-nag](https://github.com/cdklabs/cdk-nag)` for CDK security and compliance.
- [ ] Uses [Jest](https://jestjs.io/) for Typescript, [pytest](https://pytest.org/) for Python tests.
    - [ ] Includes [CDK Assertions](https://docs.aws.amazon.com/cdk/v2/guide/testing.html).
- [ ] Uses [Playwright](https://playwright.dev/) for end-to-end testing.

### Security

- [ ] Web app is behind Cognito authorization.
- [ ] Domain is an AWS owned and managed domain.
- [ ] No sensitive data is logged.
- [ ] Webpage uses HTTPS, enforces TLS 1.2+ for communication in transit.
- [ ] Dependencies/packages are decently up-to-date and secure.
    - [Dependabot](https://github.com/dependabot) can be used in GitHub.

- [ ] API keys, table/bucket names, etc. are passed through environment variables or secrets (AWS Secrets Manager), not hardcoded or submitted into code repos.
- [ ] Buckets, tables, etc. use managed encryption.
- [ ] Authentication/APIs are protected by (AWS WAF) ACLs.
- [ ] Demo does not allow users to upload unapproved content.
- [ ] Users are able to refresh or clear content created through the demo and sensitive persisted records have a TTL.
- [ ] Models have appropriate [guardrails](https://aws.amazon.com/bedrock/guardrails/).
- [ ] Embargoed content, if applicable, is gated behind an additional password/authentication.

### UI, Accessibility, and Internationalization

- [ ] Application can be run for different users in parallel, with proper data segregation and isolation.
- [ ] Can be displayed in landscape and portrait, across multiple screen sizes.
- [ ] Uses, at minimum, full HD resolution.
    - Design with large pixels in mind. The demo may look nice on a smaller screen, but bad on a larger one at the same resolution.
    - Ensure buttons and text are viewable from afar

- [ ] Uses Scalable Vector Graphics (SVG) when possible
- [ ] Uses ARIA attributes for dynamic components (dialogs, tabs, etc.)
- [ ] Allows for customizations of the UI (e.g. Use a different logo, change background color)
- [ ] Allows for quick language changes, using [i18n](https://react.i18next.com/) to support top languages (English, Mandarin, Spanish, French, Portuguese, Japanese, Korean)
    - [ ] Organizes translation files under `src/locales/{en,es,fr}/`.
    - [ ] Has a fallback locale defaulting mechanism.
    - [ ] Leverages RTL (right-to-left) support for applicable languages.

## General Guidance

### Compliance and Data Handling

- [ ] AWS has the right to all assets used in the demo (data, code libraries, generative models, images, video, etc.).
    - [ ] Uses generated or approved public datasets.
    - [ ] Does not include any customer or AWS proprietary data (AWS account numbers, embargoed features, etc.).
    - [ ] Does not use any 3rd party SaaS products like Vercel. Only uses appropriate commercially licensed packages/libraries.
    - [ ] Has legal approval to use all generative models showcased in the demo.
- [ ] Follows [AWS Responsible AI](https://aws.amazon.com/ai/responsible-ai/) guidelines.

### Operational Readiness

- [ ] Has a demo overview that, in three to four sentences, describes a specific target audience; opportunity, challenge, or problem; its business impact; and how the demo addresses it.
- [ ] Has an architecture diagram, with accurate and current Amazon/AWS service names and [icons](https://aws.amazon.com/architecture/icons/)), alongside corresponding descriptions and design decisions.
- [ ] Has a comprehensive script incorporating business value, ROI framework, presentation points, key features, and success metrics.
    - [Script template](http://live%20demo%20script%20template/)

- [ ] Has a runbook with detailed steps on how to set up and troubleshoot the demo.

## Clickthrough Guidance

- [ ] Uses the [AWS Brand Theme](https://design.amazon.com/).
- [ ] Separates use case, architecture, and demo walkthrough.
- [ ] Creates a navigation menu for each section.
    - Consider having a section for each sub-demo within a demonstration.

- [ ] Content is concise.

### Testing

- [ ] Test all hotspots and navigation
- [ ] [Assign a passcode](https://docs.storylane.io/sharing-demos/demo-protection-and-security) to embargoed or sensitive content.

## Event Guidance

- [ ] Has a backup video in case of failure.

### Runbook

- [ ] Has physical space requirements listed (dimensions, power requirements, internet connectivity needs, environment requirements like lighting, sound, etc.)
- [ ] Lists tools and number of staff required to set up and staff, including instructions.
