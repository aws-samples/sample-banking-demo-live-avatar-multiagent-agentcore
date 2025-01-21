# Gen-AI Labs Demo Starter Kit

![kyber-cli](/starter-kit-package/assets/readme-images/cli-mug-shot.png)

Welcome to the enhanced Demo Starter Kit where our goal is to provide a standardized, efficient, and flexible demo creation/management toolkit for your click through, live Gen-AI Labs demo projects.

Elevate your demo-building experience with our comprehensive toolkit, designed to streamline the process of creating & managing demos built by our Gen-AI Labs team builders. This kit incorporates:

* Several ready to deploy AppSec compliant secure CDK stacks & web app components
* Customizable CLI tooling for demo initialization & management
* Feature rich, secure, future-proof CDK Stacks, CDK constructs, Web application UI components
* A sleek React web app UI powered by Cloudscape with several sample implementation examples using Amazon Bedrock, Amazon Cognito (with Midway integration), Amazon S3, API Gateway, Amazon AppSync, Lambda Functions & much more.

While we offer a complete set of tools and components, you retain the freedom to customize or replace any element in the starter kit to suit your specific demo requirements.

For optimal results, we recommend following this guide sequentially & thoroughly. The documentation is structured into distinct sections, each building upon the last to ensure a smooth and comprehensive setup process based on the infamous [zettelkasten method](https://zettelkasten.de/overview/) so you can jump to any section from another based on your requirements.

Let's embark on creating your next impressive demo!

[TOC]

## 🗄️ Developer Machine Setup

> ℹ️ It is recommended you start here even if you machine has been setup with standard dev tools

Let's start by setting up your developer machine.

We support Mac, Windows & Cloud Desktop environments to build demo projects using this starter kit.

Please follow the guide [here](/starter-kit-package/assets/dev-machine-setup.md) to setup your machine and come back to follow the next steps.

---

## 🗄️ New Demo Setup

> ℹ️ This is a one time setup process and must be run *only the first time* you start a new demo. Ensure to complete the dev machine setup before proceeding

Start [here](/starter-kit-package/assets/new-project.md) if you are setting up a brand new demo after you have setup your developer machine.

If your demo has already been initialized & you are a pod member or builder looking to setup the demo in your local machine to start contributing, please head to [the next section](#️-setting-up-local-development).

---

## 🗄️ Setting up Local Development

> ℹ️ Start here if your demo is already setup or you want to replicate an existing demo for your local development

Once you have setup your [developer machine](#️-developer-machine-setup) and a demo has been initialized & setup by you or another pod member, you may want to -

1. create a new personal sandbox Isengard account, if not already created in the previous step and deploy the demo created by the starter kit to your personal sandbox account
2. setup and serve the app locally through <http://localhost:3000> so you can start developing backend and front features

If the answer is yes to any one of those points then please follow this guide here to [setup your local development](/starter-kit-package/assets/setup-local-development.md).

---

## 🗄️ Guides

There are several features offered by the starter kit and you may follow these guides listed here to learn them specifically

* 📚 [Kyber CLI Handbook](/starter-kit-package/assets/kyber-cli-handbook.md)
* 📚 [CDK Infra](/starter-kit-package/packages/infra/README.md)
* 📚 [Webapp](/starter-kit-package/packages/webapp/README.md)

---

## ⛳ Roadmap

A list of future roadmap items features we are targeting as part beta release

* [ ] AppSec approvals for the kit, CDK stacks & web application
* [ ] Eject feature - Generate a easy to share zip package to customers/internal teams without AWS specific configurations such as Midway & CodeArtifact dependencies
* [ ] Reusable L3 CDK constructs to create common assets like S3 buckets, REST API paths, Lambda functions
* [ ] Cedric persona to help with questions on starter kit
* [ ] CLI based kiosk creation for username/password based login

## ⚙️ Contributing

We love contributions and we have created a contributions guide for you to follow to setup the dev starter kit in your local machine to add more features, fix bugs, improve documentation etc.

[CONTRIBUTING.md](./CONTRIBUTING.md)

## ✏️ Authors and acknowledgment

* Leadership: Matthew Stanlake (stanlake@), Manuj Malik(malmanuj@) & Bamba Diouf(diouc@)
* Solution Owner: Tamil Jayakumar (tamjay@)
* Security Champion: Chris Azer (azer@)
* Principle Architect: Ryan Mich (rynmich@)
* Engineers:  Pat Santora (psantora@), Kevin Pinkerton (kppinker@), Pranav Kumar (pnavkmr@)

## 🔖 License

[Amazon Software License 1.0](/LICENSE)
