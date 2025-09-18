<!-- @export {"deleteFile": true} -->

# Frequently Asked Questions (FAQs)

## I forgot to copy the Federate client secret key. Now what?

So...you didn't keep the key(s) safe? Don't worry, we got you!

1. Navigate to the Federate [Integration](https://integ.ep.federate.a2z.com/profiles) or [Production](https://ep.federate.a2z.com/profiles) environment for which you are trying to recover the secret key.
2. Under **Service Profiles**, search for then select the **Client ID** with name as your **projectId** in the [`cdk.json` file](../../cdk.json).
3. Click on the profile **Name** link.
4. Click **Client Secrets** on the side menu.
5. Click **Create New Secret** then copy the secret key. **_Keep it safe_**.
6. Optionally, select the older secret then click **Actions** followed by **Disable**.
7. If propmpted for **Confirmation**, enter `disable` then click **Ok**.

## Can I use a different Git repository, like GitHub?

Yes! You can use a different Git repository, like GitHub.

1. Open [`cdk.json`](../../cdk.json) then set **pipeline** to `false`.
2. Optionally, edit the [pipeline stack](../../lib/stacks/pipeline.ts) to use your desired source.

## Can I just use the GitLab runner?

Due to GitLab limitations with [Docker in Docker support](https://gitlab.pages.aws.dev/docs/Platform/gitlab-cicd.html#shared-runner-fleet) and native [code replication](https://gitlab.pages.aws.dev/docs/Using%20GitLab/pushing-gitlab-repo-to-codecommit.html), we are using the [AWS Credential Vendor](https://gitlab.pages.aws.dev/docs/Platform/aws-credential-vendor.html) and an IAM role with minimal privileges to cross-authenticate into the dev account with an AWS pipeline to perform CI/CD for dev and prod accounts.
