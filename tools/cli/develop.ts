#!/usr/bin/env node

import {
    CloudFormationClient,
    DescribeStacksCommand,
    Output,
} from "@aws-sdk/client-cloudformation";
import { blueBright, bold, greenBright, redBright } from "chalk";
import enquirer from "enquirer";
import { readFileSync, writeFileSync } from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { projectConfig } from "../../config";
import {
    banner,
    bye,
    executeCommand,
    freePort,
    getProfileName,
    getStackPrefix,
    promptConfirm,
    promptMultiSelect,
    promptSelect,
    refreshCredentials,
} from "./utils";

enum Operations {
    REFRESH_CREDS = "Refresh Credentials 🔑",
    SYNTHESIZE_CDK = "Synthesize CDK Stacks 🗂️",
    DEPLOY_CDK = "Deploy CDK Stack(s) 🚀",
    HOTSWAP_CDK = "Hotswap CDK Stack(s) 🔥",
    DEPLOY_FRONTEND = "Deploy Frontend 🖥️",
    REFRESH_ENV = "Refresh Local Environment 📦",
    TEST_FRONTEND = "Test Frontend Locally 💻",
    DESTROY_CDK = "Destroy CDK Stack(s) 🗑️",
    EXIT = "Exit 👋",
}

const prodMessage = redBright("\n🛑 Changes to prod must propagate through the dev pipeline.");

const synthesizeStacks = async (stage: string): Promise<void> => {
    await executeCommand(
        `npm run -w backend cdk synth -- --profile ${getProfileName(stage)} -c stage=${stage}`
    );
};

const selectStacks = async (
    stage: string,
    action: "deploy" | "hotswap" | "destroy"
): Promise<string | undefined> => {
    if (await promptConfirm(`Would you like to just ${action} all ${stage} stacks?`)) {
        return `${getStackPrefix(stage)}*`;
    }

    console.log(blueBright(`\nListing ${stage} stacks...`));
    let stackString: string = "";
    try {
        stackString = await executeCommand(
            `npm run -w backend cdk list -- --profile ${getProfileName(stage)} -c stage=${stage}`,
            true
        );
    } catch {
        console.log(redBright(`\n🛑 Failed to synthesize ${stage} stacks.`));
        return;
    }

    const stacks = await promptMultiSelect(`stacks to ${action}`, [
        ...stackString
            .split("\n")
            .filter(
                (item) =>
                    item.startsWith(getStackPrefix(stage)) ||
                    item === `${projectConfig.projectId}-pipeline`
            )
            .map((item) => {
                return item.replace(/\s*\(.*?\)\s*$/, "").trim();
            }),
    ]);
    return stacks.map((stack) => `"${stack}"`).join(" ");
};

const deployStacks = async (stage: string, action: "deploy" | "hotswap"): Promise<void> => {
    if (stage === "prod") {
        console.log(prodMessage);
        return;
    }
    const stacks = await selectStacks(stage, action);
    if (stacks) {
        if (action === "deploy") {
            await executeCommand(
                `npm run -w backend cdk deploy ${stacks} -- --concurrency 4 --profile ${getProfileName(stage)} -c stage=${stage}`
            );
        } else if (action === "hotswap") {
            await executeCommand(
                `npm run -w backend cdk deploy ${stacks} -- --hotswap --profile ${getProfileName(stage)} -c stage=${stage}`
            );
        }
    }
};

const deployFrontendStack = async (stage: string): Promise<void> => {
    if (stage === "prod") {
        console.log(prodMessage);
        return;
    }
    if (await createLocalBuild()) {
        await executeCommand(
            `npm run -w backend cdk deploy -- -e ${getStackPrefix(stage)}-frontendDeploy --profile ${getProfileName(
                stage
            )} -c stage=${stage}`
        );
    }
};

const createLocalBuild = async (): Promise<boolean> => {
    console.log(blueBright(`\nBuilding frontend...`));
    try {
        await executeCommand("npm run -w frontend build");
        return true;
    } catch {
        console.error(redBright("\n🛑 Failed to build frontend."));
        return false;
    }
};

const createLocalEnvironment = async (stage: string): Promise<boolean> => {
    console.log(blueBright(bold("\nCreating local environment...")));

    const region = projectConfig.accounts[stage].region;

    // Get stack outputs
    let stackOutputs: Output[] = [];
    try {
        const cfClient = new CloudFormationClient({
            region,
        });
        const command = new DescribeStacksCommand({
            StackName: `${stage}-${projectConfig.projectId}-frontendDeploy`,
        });
        const response = await cfClient.send(command);
        stackOutputs = response.Stacks?.[0].Outputs ?? [];
    } catch (error) {
        console.error(
            redBright(
                "\n🛑 Failed to get stack outputs. Make sure the frontendDeploy stack is deployed."
            )
        );
        console.error("\n", error);
        return false;
    }

    const frontendPath = path.join(__dirname, "..", "..", "src", "frontend");

    // Create environment file
    const environmentVariables = stackOutputs
        .filter((output) => output.ExportName?.includes("vite-"))
        .map((output) => {
            const key = output.ExportName?.replace(/^.*?(vite-.*)/, "$1")
                .toUpperCase()
                .replace(/-/g, "_");
            return `${key}=${output.OutputValue}`;
        })
        .join("\n");
    try {
        await freePort(3000);
        writeFileSync(path.join(frontendPath, ".env"), environmentVariables);
        console.log(greenBright("\nCreated environment file!"));
    } catch {
        console.error(redBright("\n🛑 Failed to create environment file."));
        return false;
    }

    // Update GraphQL config yaml
    const graphApiId = stackOutputs.find((output) =>
        output.ExportName?.endsWith("codegen-graph-api-id")
    )?.OutputValue;
    if (graphApiId) {
        const configPath = path.join(frontendPath, ".graphqlconfig.yml");
        try {
            const graphqlConfig = yaml.parse(readFileSync(configPath, "utf-8"));

            graphqlConfig.projects["Codegen Project"].extensions.amplify.apiId = graphApiId;
            graphqlConfig.projects["Codegen Project"].extensions.amplify.region = region;

            writeFileSync(configPath, yaml.stringify(graphqlConfig));
            console.log(greenBright("\nUpdated GraphQL config file!"));

            await executeCommand("npm run -w frontend generate");
        } catch {
            try {
                console.log(blueBright("\nCreating new GraphQL config file..."));
                await executeCommand(
                    `npx -w frontend @aws-amplify/cli add codegen --apiId ${graphApiId} --region ${region}`
                );
            } catch {
                console.error(redBright("\nFailed to generate GraphQL files."));
            }
        }
    }

    if (await createLocalBuild()) {
        console.log(greenBright(bold("\nCreated local environment!")));
        return true;
    } else {
        return false;
    }
};

const createLocalServer = async (stage: string): Promise<void> => {
    if (!(await createLocalEnvironment(stage))) {
        return;
    }

    const command =
        process.platform === "win32" ? "npm run -w frontend dev" : "(npm run -w frontend dev &)";
    await executeCommand(command);
    await new Promise((resolve) => setTimeout(resolve, 1500)); // 1.5 second delay for serving

    console.log("");
    await enquirer.prompt({
        type: "input",
        name: "continue",
        message: "Press enter to continue...",
    });
    await freePort(3000);
};

const destroyStacks = async (stage: string): Promise<void> => {
    if (stage === "prod") {
        if (!(await promptConfirm("Are you sure you want to destroy prod stacks?"))) {
            return;
        }
    }
    const stacks = await selectStacks(stage, "destroy");
    if (stacks) {
        await executeCommand(
            `npm run -w backend cdk destroy ${stacks} -- --profile ${getProfileName(stage)} -c stage=${stage}`
        );
    }
};

const operations = async () => {
    let selection = "";
    try {
        selection = await promptSelect("operation", Object.values(Operations));
    } catch {
        bye(0);
    }

    if (selection === Operations.EXIT) {
        bye(0);
    }

    try {
        const stage = await promptSelect("stage", Object.keys(projectConfig.accounts));

        await refreshCredentials(stage);

        switch (selection) {
            case Operations.SYNTHESIZE_CDK:
                await synthesizeStacks(stage);
                break;
            case Operations.DEPLOY_CDK:
                await deployStacks(stage, "deploy");
                break;
            case Operations.HOTSWAP_CDK:
                await deployStacks(stage, "hotswap");
                break;
            case Operations.DEPLOY_FRONTEND:
                await deployFrontendStack(stage);
                break;
            case Operations.REFRESH_ENV:
                await createLocalEnvironment(stage);
                break;
            case Operations.TEST_FRONTEND:
                await createLocalServer(stage);
                break;
            case Operations.DESTROY_CDK:
                await destroyStacks(stage);
                break;
        }
    } catch {}

    operations();
};

const main = async () => {
    const argOperation = process.argv[2];
    const argStage = process.argv[3];

    if (argOperation && argStage) {
        if (argOperation === "deploy-frontend") {
            await deployFrontendStack(argStage);
        }
    } else {
        banner();
        await operations();
    }
};

main();
