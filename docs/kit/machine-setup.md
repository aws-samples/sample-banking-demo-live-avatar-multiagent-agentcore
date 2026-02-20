<!-- @export {"id": "kit", "deleteFile": true} -->

# Developer Machine Setup

These instructions will walk you through properly setting up your Mac, Windows, or Cloud Desktop machine for use with the AWS Marketing Demo Starter Kit.

[TOC]

## Volta/Node

[Volta](https://volta.sh/) can manage several versions of Node.js on your developer machine so you can seamlessly switch versions based on your demo needs.

1. [Install Volta](https://docs.volta.sh/guide/getting-started).
2. Run `volta install node@22` to install Node.js.
    - You may also use Node Version Manager (NVM).
    - Make sure you install the same version of Node specified in the [package.json](../../package.json).

        ```json
        "engines": {
            "node": "22.8.0"
        },
        ```

3. Ensure you do not have other global Node.js installations from Homebrew (Mac) or a standalone Node.js exe (Windows).
4. Optionally, run `volta install npm@bundled` to get the latest NPM with your Node.js version.

## Python

We highly recommend setting up a Python version manager so you can seamlessly switch versions based on your demo needs.

5. [Install uv](https://github.com/astral-sh/uv).
6. Run `uv python install 3.12.5` to install Python.
    - Make sure you install the same version of Python specified in [.python-version](../../.python-version).
7. If you have a global/system Python installation, then we recommend that you match its version to the Demo Starter Kit's version.
    - Read more on [Python versions](https://docs.astral.sh/uv/concepts/python-versions/).

## Docker

8. If you are a Mac or Windows user, [install Docker Desktop](https://www.docker.com/).
    - The Docker CLI is pre-installed for Cloud Desktop users.

## AWS CLI

9. Verify if you have v2 of the AWS CLI by running `aws --version`.
    - Uninstall v1 if necessary.
10. [Set up the AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).

## Git

11. If you are a Windows user, [install Git](https://github.com/git-guides/install-git).
    - Mac and Cloud Desktop users should have Git pre-installed.
    - You can verify Git installation by running `git -h`.
12. Run the following commands to create a global Git user:

```bash
git config --global user.email "[YOUR_ALIAS]@amazon.com" && git config --global user.name "[YOUR NAME]"
```

13. Run the following command to store/persist your details in the Git credentials store:

```bash
git config credential.helper store
```

## Kiro

14. [Install Kiro](https://kiro.dev/docs/getting-started/installation/), Amazon's AI IDE.

## Playwright MCP Extension

15. [Install the Playwright MCP Chrome Extension](https://github.com/microsoft/playwright-mcp/tree/main/packages/extension).

<!-- @export {"deleteLines": 17} -->

## Builder Toolbox

16. Run `mwinit`
    - `mwinit -f` on Mac/Windows.
    - `winit -o` on Cloud Desktop.
17. Navigate to [BuilderHub](https://docs.hub.amazon.dev/dev-setup/laptop-or-ws/) then click the link for your machine's **setup**.
18. Follow the instructions on that page to **Install Builder Toolbox**.

## AWS Developer Account (ADA)

We use [ADA](https://w.amazon.com/bin/view/DevAccount/Docs) via the CLI to manage Isengard account credentials. Alternatively, you may use the [Isengard CLI](https://w.amazon.com/bin/view/Isengard-cli/Documentation/README#HINSTALLATION).

19. Use Builder Toolbox to install ADA by running `toolbox install ada`.
20. To confirm the installation, run `ada`.
    - You should see information on usage, available commands, flags, etc.
