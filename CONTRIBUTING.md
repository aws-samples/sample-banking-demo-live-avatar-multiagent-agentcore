# Contributions

This guide will walk you through on setting up the starter kit repo itself so that you can contribute

* fixing or adding CDK stacks
* fixing or adding Web UI components
* improve/add documentation

## Overview

The starter kit container repo itself is a mono repo that includes  projects under `utils`. As of now we have only one `utility` project with is the `packager-utility`. This utility packages the actual starter kit to a zip file when you commit your changes to the starter kit.

The actual starter kit is provided as a standalone mono repo setup which gets packaged as a zip file that is downloaded by the user while they setup their demo environment.

The reason for this step is due to -

* work on the starter kit separately and use the starter kit repo to build and package the actual starter kit
* the `utils` project can receive several future projects such as Cedric integrations etc
* This repo can now have many flavours of the starter kit focussed for Gen-AI Labs team, larger SA community and even as an open source project for customers

Let's learn how to contribute to the actual starter kit now -

## Clone the repo

After following the [developer machine setup](./starter-kit-package/assets/dev-machine-setup.md), clone this repo to your dev machine and create your own feature branch.

```bash
git clone <gitlab url>

```

create a branch from main

```bash
git checkout -B feat/ALIAS
```

fast forward a feature branch to latest main branch  if you already have a feature branch created

```bash
git pull origin main --ff-only
```

## Work on the starter kit

The starter kit repo has its own dev & prod account with sandbox accounts to test your changes configured in the [Config file](./starter-kit-package/packages/infra/config/project-config.json).

Continue to work on the kit, test your changes in your feat sandbox branch and ensure to bump the version numbers in all the `package.json` files as per [semantic versioning standards](https://semver.org/) and commit your changes by running this command from the `root` of this repo -

```bash
npm run commit
```

This will -

* validate CDK & webapp
* package your repo into the `release` folder as a zip file
* adds your changes and stages your release
* commits your changes tracked under your feature branch

Then manually push your updates

```bash
git push feat/ALIAS
```

## Create a Merge Request

Once you have pushed your changes, create a merge request for your peers to review your changes. In the Merge page in GitLab, remember to select a template as shown below -
![git-templates](/starter-kit-package/assets/readme-images/git-templates.png)

Your peers will begin by validating your version of the starter kit by pulling your changes and by deploying infra + webapp using the [Kyber CLI](./starter-kit-package/assets/kyber-cli-handbook.md) to their own Sandbox accounts and approve your changes if their tests succeeds.

Now your version is the updated starter kit version which the team can use/upgrade by diffing their changes with the new releases.
