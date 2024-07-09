# GitLab Setup

This script allows you to easily configure an account to allow the [TSD GitLab](https://gitlab.aws.dev) instance to access 
resources in your account. It does this by allowing the 
[AWS Credential Vendor](https://w.amazon.com/bin/view/AWS/Teams/WWPS/TSD/GitLab#HAWSCredentialVendor) 
to assume a role in your account. In order to do this, it must:

1. Creating and/or updating a specified role that the Shared Runner can assume. It applies appropriate conditions based on
the GitLab group/project.
2. Apply a user-defined policy to the role. By default, it will use the bootstrap template. If you provide your own, it will
update that policy as needed.
3.  Re-bootstrap CDK in your account. This is because the runner role you create needs to be added to the trust policy for the
CDK roles.

```
Usage: setup_account.sh
    [--profile] Named profile. Defaults to value of AWS_PROFILE. Will be used to set Account and Region (khasnis+cdktest-Admin)
    -a|--account Account to configure. Defaults to account for current credentials (333620398242)
    -r|--region Region to configure. Defaults to currently configured value (us-east-1)
    -g|--group GitLab group allowed to assume the role in your account (genai-solutions-builder-team/genai-labs)
    -p|--project GitLab project allowed to assume the role in your account (demo-platform)
    -c|--cdk-policy-file The file that defines what GitLab can do in your account (policy.json)
    -b|--bootstrap-template Template to use as the bootstrap. If it does not exist, one will be generated(bootstrap-template.json)
    [-n|--role-name] Name of the cross-account role to create and/or update (gitlab-runner-role)
    [-h|--help] Print this help document
```
