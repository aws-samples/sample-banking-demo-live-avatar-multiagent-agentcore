## Implementation Checklist

### Coding standards

#### Languages/Frameworks

**Infrastructure**
_All manual set-up should be minimised, and where absolutely required, documented clearly in the README._

- CDK in Typescript
  - Use sub-stacks to group related components and make things clearer
  - Use dynamic naming, and include environment (e.g. dev, prod) and region in name
  - Enable [cdk-nag](https://github.com/cdklabs/cdk-nag) on all Stacks, suppress at the finest grain possible and give clear descriptions.

**Front-end**
- React in Typescript
- Components and Styling should come from [Cloudscape](https://cloudscape.design/components/) (or in future our own custom set)

**Backend**
- Either Typescript or Python
_Using typescript will lower the burden of additional linting/test tooling, but python will be a better fit for some scenarios_

**Linting**
Standard linting tools should be in place for each language/framework used, e.g. es-lint, pylint, and should be run as part of build and pipelines
{TODO: share out common config files}


#### Tests
{TODO: discuss testing expectations
- unit tests
- model tests
- UI tests
- ETE/Integration tests}

- UI Automation [TODO] - Daily Tests
- Model Eval?
}

#### Observability
{TODO: discuss expectations around tooling (what would be required in your code to pass a code review around observability):
- Cloudwatch RUM
- Cloudwatch logs (level, definition, retention)
- Cloudwatch events/alarms/dashboards
- XRay
- Lambda powertools
- etc
}

{TODO: decision on minimum expectation around tracked metrics}
{TODO: SLAs on responding to alarms}


### Auth
- All UIs should require authentication
  - Minimum requirement Cognito with self-sign-up disabled
  - Prod environment should be secured with [Midway](https://ep.federate.a2z.com/) as IDP on top of Cognito

### Branch strategy

All commits should include a related Asana ticket link (e.g. https://app.asana.com/x/xxxxxxxx/xxxxxxxxx)

_Feature branches_
- Developers should create branches from the Develop branch, and once their code is complete they should create an MR against the Develop branch

**Develop**
- No direct push to this branch
- When code is merged automated tests are run, and if they pass, it is automatically deployed to Dev

**Main**
- No direct push to this branch
- When code is merged it is automatically tested and deployed to Production
- [Tests may be run post-deployment also dependent on demo]


[If other environments are being used you may require additional branches dependent on your promotion strategy]


### Code review process
- Developers should use feature branches to write code. Code should not be directly pushed into Develop or Main.
- When the change is complete they should submit an MR against the Develop branch
- The code must be reviewed before being merged

### Accounts
- Non-Prod
- Prod

{TODO: Decide on Naming strategy and correct ownership/CTI set-up }
{TODO: look into automatic vending of accounts}


### Pipeline details
- Gitlab pipelines

{TODO: Add expectation around tests/scans to be run as part of each pipeline }
{TODO: Add example pipelines and how-to for set-up }


### Integrations
Set up an integration with Asana

