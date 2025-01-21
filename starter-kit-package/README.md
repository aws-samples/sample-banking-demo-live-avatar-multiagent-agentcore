# Your Awesome Project Name

Template for a feature rich and easy to read README

[TOC]

## Intro

So you just decided to add a README to your project. You want to create an easy
to read and easy to navigate file.

The question is: What should you do next?

Should you create one from scratch? Find a silver bullet solution? Or is it
better to customize an already existing file?

I'm going to show you how to create a README that fits your project, is easy
to read and contains everything you will ever need.

## What is this?

This project is an exhaustive README template that you can customize to your needs.
You can either add sections you like or remove sections you don't like. But you have
every time an example in front of you, from which you can derive from.

## Why should I use this?

There are many README templates out there so why this one? The two main reasons for this are
that they contain often too little content or they are not easy to read or navigate through.

## Developer Machine Setup

Please refer to this detailed getting started guide [here](./assets/getting-started.md) to setup the code base in your local developer machine.

## Demo Architecture

Use visuals to help the reader understand better. An image, diagram, chart or code example says
more than thousand words

![Diagram](doc/diagram.jpg)

### Used technologies

For sure mention all the technologies you used. If the technologies age in time you don't forget
they are used and need to be replaced.

## Guides

* 📚 [Dev machine Setup](./assets/dev-machine-setup.md)
* 📚 [Kyber CLI Handbook](./assets/kyber-cli-handbook.md)
* 📚 [CDK Infra](./packages/infra/README.md)
* 📚 [Webapp](../packages/webapp/README.md)

## Contribute

Now you are all set to make code changes of choice. Simply create a new branch from main, perform some code changes and push your code to Gitlab.
Then from Gitlab create a merge request from your feature branch feat/alias-feature-name to main which will trigger a GitCI runner to trigger AWS CodePipeline in the target dev account automatically. Some useful Git commands are listed here -

```text
# create a branch from main
git checkout -B feat/ALIAS

# fast forward a feature branch to latest main branch 
git pull origin main --ff-only

# git commit & push (execute from prohect root)
npm run commit 

```

## Authors and acknowledgment

Show your appreciation to those who have contributed to the project.

## License

[Amazon Software License 1.0](/LICENSE)
