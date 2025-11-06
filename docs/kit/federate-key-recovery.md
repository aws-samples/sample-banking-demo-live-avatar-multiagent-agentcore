<!-- @export {"deleteFile": true} -->

# Federate Key Recovery

So...you didn't keep the key(s) safe? Don't worry!

1. Navigate to the Federate [Integration](https://integ.ep.federate.a2z.com/profiles) or [Production](https://ep.federate.a2z.com/profiles) environment for which you are trying to recover the secret key.
2. Under **Service Profiles**, search for then select the **Client ID** with name as your **projectId** in the [`cdk.json` file](../../cdk.json).
3. Click on the profile **Name** link.
4. Click **Client Secrets** on the side menu.
5. Click **Create New Secret** then copy the secret key.
6. Optionally, select the older secret then click **Actions** followed by **Disable**.
7. If prompted for **Confirmation**, enter `disable` then click **Ok**.
