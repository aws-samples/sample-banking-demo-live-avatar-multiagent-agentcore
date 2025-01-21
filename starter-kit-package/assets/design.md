# Features

The starter kit comes with several features fronted by a powerful and a customizableCLI tool.

* Auto credential rotation - never worry about setting uyp Isengard account credentials anymore! The CLI auto maps your accounts ith correct region for your demo
* Centralized Configuration - manage your entire demo from a centralized config JSON file. This file gets checked in to Git so all pod members have same project wide configurations
*

### GitLab Group

> Do not change this unless you initialized your GitLab project under a different group.

This setting is used by the starter kit to automate the GitLab CI for CI/CD purposes and must not be changed unless you initialized your GitLab project under a different group or under your personal project group.

You can find your GitLab group from your project Git URL usually in this format `https://gitlab.aws.dev/GROUP-NAME/SLUG`.  

### GitLab Project Name

> Must match your GitLab Slug

This is different from your unique project name identifier & is usually the slug reference GitLab uses.

This setting is used by the starter kit to automate the GitLab CI for CI/CD purposes and must match your GitLa project name exactly.

You can find your GitLab Slug from your project Git URL or from the settings page of your GitLab project. The last part of the URL is always the slug you chose for your GitLab project.

### CodeArtifact

CodeArtifact (formerly Goshawk) is a secure, highly scalable, managed artifact repository service that makes it easy for organizations to store and share software packages used for application development. Read more on [CodeArtifact](https://docs.hub.amazon.dev/codeartifact/user-guide/getting-started/).

We strongly recommend keeping this setting turned on by marking the option as `true`. This setting can be toggled later even after setting up the demo.

#### CodeArtifact/Goshawk Onboarding tool

> **WARNING** 🚨 - goshawk-onboard is facing errors so skip to the next steps for a workaround!

We are currently facing an issue with the onboarding of new accounts and are actively working to resolve this. Please skip this step as of now as we have a workaround!

```txt
Source: Error: Not all members in account XXXXXXXXXX are in source-code.
```

> MUST use VPN & Kerberos login

This step sets up an internal tool to allow list and onboard a newly created Isengard account to stat using CodeArtifact packages. We highly recommend using CodeArtifact for installing NPM packages as this improves the security posture.

1. Connect to your VPN using the `Cisco AnyConnect` client
2. In a new terminal or CMD window enter the command `kinit`
3. Enter the password you use to login to your machine (NOT your Midway pin!)
4. Run this command

    ```bash
    npm install -g git+ssh://git.amazon.com/pkg/NodeJS-amzn-goshawk-onboarder-client
    ```

    This will install the utility tool in your dev machine that allows you to onboard new Isengard to use CodeArtifact
5. Run this command to onboard your Isengard account

    ```bash
    goshawk-onboard MY_AWS_ACCOUNT
    ```

#### CodeArtifact/Goshawk Workaround

> This is an interim step while we resolve the issues above.

In order to install NPM packages from CodeArtifact, we need an account that can be used to authenticate with CodeArtifact and has been allow-listed. Fortunately, we have a central account that has been onboarded previously which allows members of the GenAI Labs team to authenticate themselves.

In a new terminal or a CMD window **from the project root** enter the following commands

```bash
cd /project_root_path 
```

```bash
ada credentials update --provider=isengard --role Admin --once --account=010526252695
```

You will see a message that says `Refreshing aws credentials for default` and `Successfully refreshed aws credentials for default`.

Let's now login to CodeArtifact using the central account's credentials

```bash
aws codeartifact login --tool npm --repository shared --domain amazon --domain-owner 149122183214 --region us-west-2
```

Once the command runs, you should see a message that says `Login expires in 12 hours at XXXXXXX`.

### Code Pipeline

Since there are multiple accounts involved, it is imperative for us to configure a CI/CD pipeline setup to automatically build and deploy the demo to target accounts after a commit to GitLab.

We strongly recommend keeping this setting turned on by marking the option as `true`. If you turn this option to `false` you can still use the `Kyber CLI tool` to deploy the entire app (CDK + Webapp) to any configured account of choice.

This setting can be toggled later even after setting up the demo.
