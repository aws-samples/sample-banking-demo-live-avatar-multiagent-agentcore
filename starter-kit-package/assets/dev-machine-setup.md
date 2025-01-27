# Dev machine Setup

This guide will help you to -

* Configure your developer environment on your dev machine (Mac/Windows/Cloud Desktop)
* Install several mandatory builder tools
* Install software packages needed to run the starter kit
* Setup and run the starter kit CLI automation tool

This setup guide will cover setting up your Mac or windows laptop or Cloud Desktop. Some setup steps may include OS specific instructions so please read carefully.

Although this is a one time setup process, we recommend running through this step up each time you begin a new demo.

[TOC]

## mwinit

> ℹ️ Ensure to run this command every day when you start your development tasks.

It is mandatory for all AWS builders to setup the `mwinit` utility from this [the official setup guide](https://docs.hub.amazon.dev/dev-setup/laptop-or-ws/). Ensure to select the correct operating system and follow the guides carefully.

Then authenticate using the following command in a terminal or a CMD window -

> ⚠️ - OS specific command. After running this command, ensure to follow the instructions in the command response.

```bash
mwinit --fido2
```

> 💻 Mac/Cloud Desktop users only. Others please skip to [next section](#toolbox)

Here is an alias that you can configure in your `~/.zshrc` or `~/.bashrc` file to automate `mwinit` every day you start work. Simply create these [aliases](https://shapeshed.com/unix-alias/) -

```bash
alias git-auth='eval $(ssh-agent -s) && ssh-add'
alias auth='mwinit --fido2 && source ~/.zshrc && source ~/.bashrc && git-auth'
```

When you are starting your day, open a new `terminal` or a `zsh` window and enter -

```bash
auth
```

Windows users, may the force be with you! 😐

## Toolbox

It is mandatory for all AWS builders to setup `toolbox` CLI to install several AWS Builder tools.

> ⚠️ - OS specific steps in the link below.

Follow [this guide](https://docs.hub.amazon.dev/builder-toolbox/user-guide/getting-started/)  to setup `toolbox`.

Verify `toolbox` setup by running the following command in a terminal or a CMD window -

```bash
toolbox list
```

## ADA CLI

> ⚠️ - OS specific steps in the link below.

Let's use the `toolbox` to install `ada`. [ADA](https://w.amazon.com/bin/view/DevAccount/Docs) stands for AWS Developer Account. This tool helps in getting Isengard/Conduit account credentials from the command line without copy pasting AWS account credentials from Isengard/Conduit. ADA also manages profiles and rotates credentials automatically when an AWS CLI command is used with a profile name.

An AWS Dev Account is an AWS account owned and used by internal Amazon developers, typically created from [Merlon](https://iad.merlon.amazon.dev/register/create?redirectMerlon=isengard) using Isengard/Conduit, and customized for development (guardrailed, enhanced with specific functionality such as purge).

> ❔ [Why use ADA and not Isengard CLI?](./faq.md#why-use-ada-and-not-isengard-cli)

ADA does support getting credentials for Conduit burner accounts as well. Feel free to adjust the following command as per the docs if you are using accounts vended by Conduit.

> ℹ️ We prefer using Isengard accounts as Gen-AI Labs demos are long running with a continuous development cycle.

Run the following command in a terminal or a CMD window -

```bash
toolbox install ada
```

Now you can easily use the account credentials to perform several `aws-cli` commands from a terminal.

We have used `ada` in the CLI tooling to automate the set up of dev/prod/sandbox accounts to manage the demo. More on this later ;)

> ⚠️ - Isengard accounts only for which you have Admin role access privileges.

Run the following command in a terminal or a CMD window with an Isengard account you own to test ADA  -

```bash
ada credentials update --account=XXXXXXXXXXX --provider=isengard --role=Admin --once
```

You will see the output

```text
Refreshing aws credentials for default
Successfully refreshed aws credentials for default
```

### NPM Audit Tool

NPM packages contain sever securityy vulnerabilities and require frequent analysis. The official `npm` audit command **(should never be used at Amazon)**.

As an alternative we recommend recommend using a tool from toolbox called `npm-eevee-audit` to do this which is similar to the base `npm` audit command.

Let's install the audit tool by entering this command in a terminal or a CMD window

```bash
toolbox install npm-eevee-audit
```

## Volta

> ❔ [I use Node Version Manager (NVM). Can I use that?](./faq.md#i-use-node-version-manager-nvm-can-i-use-that)

Volta is a modern fast, reliable & universal tool for managing JS tools such as `node`, `pnpm`  & `yarn`.

Volta manager several versions of NodeJS in your developer machine so we may seamlessly switch versions based on your demo needs.

Let's begin by installing `volta`

Mac/Unix installation

```cmd
curl https://get.volta.sh | bash
```

For Windows please continue the installation from [here](https://docs.volta.sh/guide/getting-started).

You can verify the successful installation of `volta` by running this command in a terminal or a CMD window

```bash
volta help 
```

## Node JS Installation

Now we can use `volta` to easily install NodeJs.

```bash
volta install node@22
```

This command will install the latest LTS version of Node Js in your developer machine.

Optionally, you may also run this command to get the latest NPM along with your NodeJS version

```bash
volta install npm@bundled
```

We have configured Volta to pin the NodeJS version in the [package.json](../package.json) so the starter kit will always use this version across various users with Mac/Windows/Cloud Desktop.

```json
 "volta": {
    "node": "22.8.0"
  }
```

## Python version Manager

> ⚠️ - OS specific steps in the link below.

We highly recommend setting up a version manager for python to manage several versions of python in your developer machine so we may seamlessly switch versions based on your demo needs.

### Mac/Cloud Desktop Users

Please install the `pyenv` tool from [here](https://github.com/pyenv/pyenv?tab=readme-ov-file#installation). The tool enables to select & install specific versions of python in your dev machine.

### Windows Users

Please install the `pyenv-win` fork from [here](https://github.com/pyenv-win/pyenv-win) which provides the same set of command sas `pyenv` to manage python versions in your dev machine.

### Install Python

After installing the `pyenv` or `pyenv-win` based on your OS, on your dev machine, please ensure to install python version `3.12.5` in your machine by running the command in a terminal or a CMD window.

```bash
pyenv install 3.12.5
```

We have already configured a local `.python-version` file for the starter kit to  always use version `3.12.5` across various users with Mac/Windows/Cloud Desktop.

You may read more on setting global & local configs [here](https://realpython.com/intro-to-pyenv/#specifying-your-python-version) for `pyenv`. if you have a global python version configured via `pyenv` then we recommend that you match the global version to `3.12.5`.

### AWS CLI V2

> 🚨 ensure to uninstall AWS CLI V1 before proceeding

Verify if you have v1 by running

```sh
aws --version
```

> ⚠️ - OS specific steps in the link below.

Setup AWS CLI from [here](https://aws.amazon.com/cli/).

Please verify your installation by following the guide [here](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)

## Git setup

Please follow [this guide](https://github.com/git-guides/install-git) if you are a windows user.

Mac & CloudDesktop users must have Git pre-installed. You can verify Git installation by running and you should not see any errors.

```bash
git -h
```

After you have validated Git installation, please run the following commands from a terminal or a CMD window.

```bash
git config --global user.email "YOUR-ALIAS@amazon.com" && git config --global user.name "YOUR NAME" 
```

Then enter this command to store/persists your details to the GIT credentials store

```bash
git config credential.helper store
```

## VSCODE

VSCODE is available to setup from AWS self Service Portal from your ACME service that comes pre-installed on your machine.

## Docker Desktop

> ℹ️ - Cloud Desktop user can skip this as Docker CLI is pre-installed for Cloud Desktop users.

We rely on several docker commands to speed up and make the developer experience seamless for building & managing Gen-AI demos.

Please install Docker Desktop application from [here](https://www.docker.com/) based on your operating system.

> 🚨 DO NOT sign-in/sign-up in Docker Desktop or ACME tool will auto uninstall it. Read more [here](https://docs.hub.amazon.dev/containers/docker/#docker-desktop)

### Docker Engine

> ℹ️ - Only for Mac & Windows users

Docker is known to consume a lot of disk space and doesn't auto remove older images & accrues a lot of logs by default. Please use this configuration to save your precious disk space -

1. Open Docker Desktop
2. Click on the gear icon ⚙️ on top right corner
3. Select `Docker Engine` menu option on the left side
4. Copy & paste the following configuration as is and hit `Apply & restart`

```json
{
  "builder": {
    "gc": {
      "defaultKeepStorage": "20GB",
      "enabled": true
    }
  },
  "experimental": false,
  "log-driver": "json-file",
  "log-format": "text",
  "log-level": "info",
  "log-opts": {
    "cache-compress": "true",
    "cache-disabled": "false",
    "cache-max-file": "5",
    "cache-max-size": "20m",
    "env": "os,customer",
    "labels": "somelabel",
    "max-file": "5",
    "max-size": "10m"
  },
  "max-concurrent-downloads": 1
}
```

## Amazon Q Developer

The Amazon Q Developer Accelerator (QDA) program (previously the CodeWhisperer Adoption Program) is a builder-to-builder outreach initiative aiming to drive Amazon Q Developer service adoption (includes CodeWhisperer) and connect AWS account teams with resources to enable their customers to build and innovate.

Please follow these instructions to [setup Amazon Q with VS-CODE IDE](https://docs.hub.amazon.dev/qdeveloper/user-guide/getting-started/).

Check here for all [other supported IDEs](https://aws.amazon.com/q/developer/).

---

Please click the back button in your browser to head back to main readme.

## Next Steps
