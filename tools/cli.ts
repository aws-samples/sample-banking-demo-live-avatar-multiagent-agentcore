#!/usr/bin/env node
// @export {"id": "kit", "deleteFile": true}

import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import {
    AdminCreateUserCommand,
    AdminDeleteUserCommand,
    CognitoIdentityProviderClient,
    ListUsersCommand,
    ListUsersCommandOutput,
} from "@aws-sdk/client-cognito-identity-provider";
import {
    CreateSecretCommand,
    GetSecretValueCommand,
    ResourceNotFoundException,
    SecretsManagerClient,
    UpdateSecretCommand,
    UpdateSecretCommandInput,
} from "@aws-sdk/client-secrets-manager";
import { fromIni } from "@aws-sdk/credential-providers";
import { checkbox, confirm, input, password, select } from "@inquirer/prompts";
import { blueBright, bold, greenBright, magentaBright } from "chalk";
import { spawn } from "child_process";
import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import * as yaml from "yaml";

const cdkContext = JSON.parse(
    readFileSync(path.join(__dirname, "..", "cdk.json"), "utf-8")
).context;
enum PresetStage {
    Dev = "dev",
    Prod = "prod",
}

// #region helper functions

const prompt = {
    confirm: async (message: string): Promise<boolean> => {
        console.log("");
        return await confirm({
            message,
            default: true,
        });
    },
    input: async (message: string, secret = false, defaultValue?: string): Promise<string> => {
        console.log("");
        const validate = (value: string) => value.trim() !== "" || "Cannot be empty.";
        if (secret) {
            return await password({
                message,
                validate,
                mask: "*",
            });
        } else {
            return await input({
                message,
                default: defaultValue,
                validate,
            });
        }
    },
    select: async (item: string, choices: string[]): Promise<string> => {
        console.log("");
        return await select({
            message: `Select the ${item}:`,
            choices,
            pageSize: Math.min(choices.length, 15),
            loop: false,
        });
    },
    multiSelect: async (items: string, choices: string[]): Promise<string[]> => {
        console.log("");
        return await checkbox({
            message: `Select ${items}:`,
            choices,
            validate: (value) => (value.length > 0 ? true : `Select at least one of the ${items}.`),
        });
    },
};

const executeCommand = <T extends boolean = false>(
    command: string,
    saveOutput?: T
): Promise<T extends true ? string : void> => {
    if (!saveOutput) console.log(`\n${blueBright("Executing command:")} ${command}\n`);

    return new Promise((resolve, reject) => {
        const childProcess = spawn(command, [], {
            stdio: saveOutput ? "pipe" : "inherit",
            shell: true,
            env: { ...process.env },
        });

        let output = "";
        if (saveOutput) {
            childProcess.stdout?.on("data", (data) => {
                output += data.toString();
            });
            childProcess.stderr?.on("data", (data) => {
                output += data.toString();
            });
        }

        childProcess.on("close", (code) => {
            if (code === 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                resolve(saveOutput ? (output as any) : undefined);
            } else {
                reject(new Error(`Command exited with code ${code}.`));
            }
        });
        childProcess.on("error", (error) => {
            reject(error);
        });
    });
};

const getProfileName = (stage: string): string => {
    return `${cdkContext.projectId}-${stage}`;
};

const getProfileCredentials = (stage: string) => {
    return fromIni({ profile: getProfileName(stage), ignoreCache: true });
};

const getAccountDetail = (stage: string, detail: "number" | "region"): string => {
    return cdkContext.accounts[stage][detail];
};

const getStackPrefix = (stage: string): string => {
    let stackPrefix = `${stage}/${cdkContext.projectId}`;
    if (cdkContext.pipeline && stage === PresetStage.Dev) {
        stackPrefix = `${cdkContext.projectId}-pipeline/${stackPrefix}`;
    }
    return stackPrefix;
};

const getEnvironmentVariables = async (stage: string) => {
    let outputs;
    try {
        const response = await new CloudFormationClient({
            region: getAccountDetail(stage, "region"),
            credentials: getProfileCredentials(stage),
        }).send(
            new DescribeStacksCommand({
                StackName: `${stage}-${cdkContext.projectId}-frontendDeployment`,
            })
        );
        outputs = response.Stacks?.[0].Outputs;
    } catch (error) {
        throw new Error("Failed to get environment variables.", { cause: error });
    }
    const environmentVariablesOutput = outputs?.find(
        (output) => output.OutputKey === "environmentVariables"
    )?.OutputValue;
    if (!environmentVariablesOutput) {
        throw new Error(
            "Failed to find environment variables. Make sure the environmentVariables CloudFormation output exists."
        );
    } else return JSON.parse(environmentVariablesOutput) as Record<string, string>;
};

const selectStacks = async (
    stage: string,
    action: "deploy" | "hotswap" | "destroy",
    all: boolean = false
): Promise<string | undefined> => {
    if (
        stage === "prod" &&
        !(await prompt.confirm(`Are you sure you want to ${action} prod stacks?`))
    ) {
        return;
    }

    if (
        action !== "destroy" &&
        (all || (await prompt.confirm(`Would you like to just ${action} all ${stage} stacks?`)))
    ) {
        return `${getStackPrefix(stage)}*`;
    }

    console.log(blueBright(`\nListing ${stage} stacks...`));
    let stackString: string = "";
    try {
        stackString = await executeCommand(
            `npm run cdk list -- --profile ${getProfileName(stage)} -c stage=${stage}`,
            true
        );
    } catch {
        throw new Error(`Failed to synthesize ${stage} stacks.`);
    }

    const stacks = await prompt.multiSelect(`stacks to ${action}`, [
        ...stackString
            .split("\n")
            .filter(
                (item) =>
                    item.startsWith(getStackPrefix(stage)) ||
                    item === `${cdkContext.projectId}-pipeline`
            )
            .map((item) => item.replace(/\s*\(.*?\)\s*$/, "").trim()),
    ]);
    return stacks.map((stack) => `"${stack}"`).join(" ");
};

const createLocalBuild = async () => {
    console.log(blueBright(`\nBuilding frontend...`));
    try {
        await executeCommand("npm run -w frontend build");
    } catch {
        throw new Error("Failed to build frontend.");
    }
};

const printError = (error: Error) => {
    console.log("");
    if (error.cause instanceof Error) {
        console.error(error.cause.message);
    }
    console.error(bold(error.message));
};

const bye = (exitCode: number = 1) => {
    if (exitCode === 0) {
        console.log(bold(magentaBright("\nGoodbye! 👋\n")));
    } else {
        console.log("");
    }
    process.exit(exitCode);
};

const checkCredentials = async (profileName: string) => {
    try {
        await executeCommand(`aws sts get-caller-identity --profile ${profileName}`, true);
        return true;
    } catch {
        return false;
    }
};

const ensureCredentials = async (stage: string) => {
    if (!(await checkCredentials(getProfileName(stage)))) {
        console.warn(`\nFailed to get ${stage} credentials profile.`);
        await configureCredentials(stage);
    }
};

// #endregion

// #region operation functions

const configureCredentials = async (stage: string, method?: string) => {
    const profileName = getProfileName(stage);

    if (
        (await checkCredentials(profileName)) &&
        !(await prompt.confirm(
            `Already configured ${stage} credentials profile "${profileName}". Do you want to reconfigure it?`
        ))
    ) {
        return;
    }

    console.log(blueBright(`\nConfiguring ${stage} credentials profile "${profileName}"...`));
    const credentialType =
        method ||
        (await prompt.select("credential method", [
            "AWS Developer Account",
            "IAM Identity Center",
            "Short-term Credentials",
        ]));
    try {
        if (credentialType === "IAM Identity Center") {
            await executeCommand(`aws configure sso --profile ${profileName}`);
        } else if (credentialType === "Short-term Credentials") {
            await executeCommand(`aws configure --profile ${profileName}`);
        } else if (credentialType === "AWS Developer Account") {
            await executeCommand(
                `ada credentials update --profile=${profileName} --account=${getAccountDetail(stage, "number")} --provider=isengard --role=Admin --once`
            );
        }
        console.log(greenBright(`\nConfigured ${stage} credentials profile "${profileName}"!`));
    } catch (error) {
        throw new Error(`Failed to configure ${stage} credentials profile "${profileName}".`, {
            cause: error,
        });
    }
};

const configureSecret = async (stage: string, secretNameInput?: string, secretValue?: string) => {
    const account = cdkContext.accounts[stage];

    try {
        const secretsManagerClient = new SecretsManagerClient({
            region: account.region,
            credentials: getProfileCredentials(stage),
        });
        const secretName = `${cdkContext.projectId}-${secretNameInput || (await prompt.input(`Enter the secret name/ID:`, false, "federateSecret"))}`;

        let secretExists = false;
        try {
            await secretsManagerClient.send(new GetSecretValueCommand({ SecretId: secretName }));
            secretExists = true;
        } catch (error) {
            if (!(error instanceof ResourceNotFoundException)) throw error;
        }

        if (
            secretExists &&
            !(await prompt.confirm(
                `Already configured ${stage} secret. Do you want to reconfigure it?`
            ))
        ) {
            return;
        }

        console.log(blueBright(`\nConfiguring ${stage} secret...`));
        let secret = "";

        if (secretValue) {
            secret = secretValue;
        } else if (Object.values(PresetStage).includes(stage as PresetStage)) {
            secret = await prompt.input(`Enter the secret:`, true);
        } else {
            try {
                console.log(blueBright(`\nCopying dev secret...`));
                await ensureCredentials(PresetStage.Dev);
                secret = (
                    await new SecretsManagerClient({
                        region: getAccountDetail(PresetStage.Dev, "region"),
                        credentials: getProfileCredentials(PresetStage.Dev),
                    }).send(
                        new GetSecretValueCommand({
                            SecretId: secretName,
                        })
                    )
                ).SecretString!;
            } catch (error) {
                if (!(error instanceof ResourceNotFoundException)) throw error;
                console.warn("\nFailed to copy dev secret.");
                secret = await prompt.input(`Enter the secret:`, true);
            }
        }

        const secretProperties: Partial<UpdateSecretCommandInput> = {
            SecretString: secret,
        };
        if (secretExists) {
            await secretsManagerClient.send(
                new UpdateSecretCommand({
                    SecretId: secretName,
                    ...secretProperties,
                })
            );
        } else {
            await secretsManagerClient.send(
                new CreateSecretCommand({
                    Name: secretName,
                    ...secretProperties,
                })
            );
        }

        console.log(greenBright(`\nConfigured ${stage} secret!`));
    } catch (error) {
        throw new Error(`Failed to configure ${stage} secret.`, { cause: error });
    }
};

const bootstrapAccount = async (stage: string) => {
    const account = cdkContext.accounts[stage];

    const bootstrapRegion = async (region: string) => {
        const isProd = stage === PresetStage.Prod;
        console.log(
            blueBright(
                `\nBootstrapping${isProd ? ", enabling termination protection and setting up trust with dev account for" : ""} ${stage} account in ${region}...`
            )
        );
        try {
            await executeCommand(
                `npm run cdk bootstrap aws://${account.number}/${region} -- ` +
                    `--cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess ` +
                    `--profile ${getProfileName(stage)}` +
                    (isProd
                        ? ` --termination-protection --trust ${getAccountDetail(PresetStage.Dev, "number")}`
                        : "")
            );
            console.log(greenBright(`\nBootstrapped ${stage} account in ${region}!`));
        } catch (error) {
            throw new Error(`Failed to bootstrap ${stage} account in ${region}.`, {
                cause: error,
            });
        }
    };
    await bootstrapRegion(account.region);
    if (account.region !== "us-east-1") await bootstrapRegion("us-east-1");
};

const synthesizeStacks = async (stage: string): Promise<void> => {
    await executeCommand(
        `npm run cdk synth -- --profile ${getProfileName(stage)} -c stage=${stage}`
    );
};

const deployStacks = async (
    stage: string,
    action: "deploy" | "hotswap",
    all: boolean = false
): Promise<void> => {
    const stacks = await selectStacks(stage, action, all);
    if (stacks) {
        if (action === "deploy") {
            await executeCommand(
                `npm run cdk deploy ${stacks} -- --concurrency 4 --profile ${getProfileName(stage)} -c stage=${stage}`
            );
        } else if (action === "hotswap") {
            await executeCommand(
                `npm run cdk deploy ${stacks} -- --hotswap --profile ${getProfileName(stage)} -c stage=${stage}`
            );
        }
    }
};

const deployFrontendStack = async (stage: string): Promise<void> => {
    if (
        stage === "prod" &&
        !(await prompt.confirm(`Are you sure you want to deploy prod frontend?`))
    ) {
        return;
    }

    await createLocalBuild();
    await executeCommand(
        `npm run cdk deploy -- -e ${getStackPrefix(stage)}-frontendDeployment --profile ${getProfileName(stage)} -c stage=${stage}`
    );
};

const createLocalEnvironment = async (stage: string) => {
    const frontendPath = JSON.parse(
        await executeCommand('npm query .workspace name="frontend"', true)
    )[0].path;
    const environmentVariables = await getEnvironmentVariables(stage);

    try {
        // create environment file
        writeFileSync(
            path.join(frontendPath, ".env"),
            Object.entries(environmentVariables)
                .map(([key, value]) => `${key}=${value}`)
                .join("\n")
        );
        console.log(greenBright("\nCreated environment file!"));
    } catch (error) {
        throw new Error("Failed to create environment file.", { cause: error });
    }

    const region = getAccountDetail(stage, "region");
    // create/update GraphQL config yaml
    const graphApiId = environmentVariables["CODEGEN_GRAPH_API_ID"];
    if (graphApiId) {
        const configPath = path.join(frontendPath, ".graphqlconfig.yml");
        let graphqlConfig = {
            projects: {
                "Codegen Project": {
                    schemaPath: "schema.json",
                    includes: ["src/common/graphql/**/*.ts"],
                    extensions: {
                        amplify: {
                            codeGenTarget: "typescript",
                            generatedFileName: "src/common/graphql/types.ts",
                            docsFilePath: "src/common/graphql",
                            region: region,
                            apiId: graphApiId,
                            frontend: "javascript",
                            framework: "react",
                            maxDepth: 2,
                        },
                    },
                },
            },
        };
        let successMessage = greenBright("\nCreated GraphQL config file!");
        try {
            if (existsSync(configPath)) {
                graphqlConfig = yaml.parse(readFileSync(configPath, "utf-8"));
                graphqlConfig.projects["Codegen Project"].extensions.amplify.apiId = graphApiId;
                graphqlConfig.projects["Codegen Project"].extensions.amplify.region = region;
                successMessage = greenBright("\nUpdated GraphQL config file!");
            }

            writeFileSync(configPath, yaml.stringify(graphqlConfig));
            console.log(successMessage);
            await executeCommand(
                `AWS_PROFILE=${getProfileName(stage)} npm run -w frontend generate`
            );
        } catch (error) {
            throw new Error("Failed to generate GraphQL files.", { cause: error });
        }
    }

    await createLocalBuild();
};

const createLocalServer = async (stage: string): Promise<void> => {
    const freePort = async (port: number) => {
        const processId = await executeCommand(
            `lsof -i :${port} | grep LISTEN | awk '{print $2}'`,
            true
        );
        if (processId) {
            try {
                await executeCommand(`kill -9 ${processId}`, true);
                console.log(greenBright(`\nFreed port ${port}!`));
            } catch (error) {
                throw new Error(`Failed to free port ${port}.`, { cause: error });
            }
        }
    };
    await freePort(3000);
    await createLocalEnvironment(stage);

    const command =
        process.platform === "win32" ? "npm run -w frontend dev" : "(npm run -w frontend dev &)";
    await executeCommand(command);
    await new Promise((resolve) => setTimeout(resolve, 1500)); // 1.5 second delay for serving

    console.log("");
    await input({
        message: "Press enter to continue...",
    });
    await freePort(3000);
};

const manageUser = async (stage: string) => {
    enum UserManagementActions {
        CREATE_USER = "Create User",
        DELETE_USER = "Delete User",
    }

    const environmentVariables = await getEnvironmentVariables(stage);
    const userPoolId = environmentVariables
        ? Object.entries(environmentVariables).find(([key]) => key.includes("USER_POOL_ID"))?.[1]
        : undefined;
    if (!userPoolId) {
        throw new Error(`Default user pool not found.`);
    }
    console.log(greenBright(`\nFound default user pool!`));

    const cognitoClient = new CognitoIdentityProviderClient({
        region: getAccountDetail(stage, "region"),
        credentials: getProfileCredentials(stage),
    });

    const manageUserOperation = await prompt.select(
        "operation",
        Object.values(UserManagementActions)
    );
    switch (manageUserOperation) {
        case UserManagementActions.CREATE_USER: {
            const email = await prompt.input(`Enter an email address:`);
            try {
                await cognitoClient.send(
                    new AdminCreateUserCommand({
                        UserPoolId: userPoolId,
                        Username: email,
                        UserAttributes: [
                            { Name: "email", Value: email },
                            { Name: "email_verified", Value: "true" },
                        ],
                    })
                );
                console.log(
                    greenBright(`\nCreated user!`),
                    greenBright(`\nEmailed temporary password to ${email}.`)
                );
            } catch (error) {
                throw new Error(`Failed to create user.`, { cause: error });
            }
            break;
        }
        case UserManagementActions.DELETE_USER: {
            console.log(blueBright("\nListing users..."));
            let listResponse: ListUsersCommandOutput;
            try {
                listResponse = await cognitoClient.send(
                    new ListUsersCommand({
                        UserPoolId: userPoolId,
                    })
                );
            } catch (error) {
                throw new Error(`Failed to list users.`, { cause: error });
            }
            const users =
                listResponse.Users?.filter((user) => !user.Username?.startsWith("Amazon")) || [];
            if (users.length === 0) {
                throw new Error(`No users found.`);
            }
            let user = "";
            try {
                const userEmails = users.map((user) => {
                    return (
                        user.Attributes?.find((attr) => attr.Name === "email")?.Value ||
                        user.Username ||
                        ""
                    );
                });
                const selectedEmail = await prompt.select("user", userEmails);
                if (
                    !(await prompt.confirm(
                        `Are you sure you want to delete user ${selectedEmail}?`
                    ))
                ) {
                    return;
                }
                user = users[userEmails.indexOf(selectedEmail)]?.Username || "";
            } catch {
                return;
            }
            try {
                await cognitoClient.send(
                    new AdminDeleteUserCommand({
                        UserPoolId: userPoolId,
                        Username: user,
                    })
                );
                console.log(greenBright(`\nDeleted user.`));
            } catch (error) {
                throw new Error(`Failed to delete user.`, { cause: error });
            }
            break;
        }
    }
};

const destroyStacks = async (stage: string): Promise<void> => {
    const stacks = await selectStacks(stage, "destroy");
    if (stacks) {
        await executeCommand(
            `npm run cdk destroy ${stacks} -- --profile ${getProfileName(stage)} -c stage=${stage}`
        );
    }
};

// #endregion

enum Actions {
    CONFIGURE_CREDS = "Configure Credentials 🪪",
    CONFIGURE_SECRET = "Configure Secret 🔒",
    BOOTSTRAP_ACCOUNT = "Bootstrap Account 🥾",
    SYNTHESIZE_STACKS = "Synthesize CDK Stacks 🗂️",
    DEPLOY_STACKS = "Deploy CDK Stack(s) 🚀",
    HOTSWAP_STACKS = "Hotswap CDK Stack(s) 🔥",
    DEPLOY_FRONTEND = "Deploy Frontend 🖥️",
    REFRESH_FRONTEND = "Refresh Local Environment 📦",
    TEST_FRONTEND = "Test Frontend Locally 💻",
    MANAGE_USER = "Manage Cognito User 👤",
    DESTROY_STACKS = "Destroy CDK Stack(s) 🗑️",
    BACK = "Back ⬅️",
    EXIT = "Exit 👋",
}

const stageArgument = "[stage]";
const getStageOption = (stage?: string) => {
    if (stage && !cdkContext.accounts[stage]) {
        console.error(bold(`Missing ${stage} account in cdk.json.`));
        bye(1);
    }
    return stage ?? prompt.select("stage", Object.keys(cdkContext.accounts));
};

const program = new Command();
program.name("kit").description("Demo Starter Kit CLI");

program
    .command("configure-credentials")
    .description(Actions.CONFIGURE_CREDS)
    .argument(stageArgument)
    .option(
        "-m, --method <method>",
        "credential method (AWS Developer Account, IAM Identity Center, Short-term Credentials)"
    )
    .action(async (stage, options) => {
        await configureCredentials(await getStageOption(stage), options.method);
    });

program
    .command("configure-secret")
    .description(Actions.CONFIGURE_SECRET)
    .argument(stageArgument)
    .option("-n, --name <name>", "secret name/ID")
    .option("-v, --value <value>", "secret value")
    .action(async (stage, options) => {
        await configureSecret(await getStageOption(stage), options.name, options.value);
    });

program
    .command("bootstrap")
    .description(Actions.BOOTSTRAP_ACCOUNT)
    .argument(stageArgument)
    .action(async (stage) => {
        await bootstrapAccount(await getStageOption(stage));
    });

program
    .command("synth")
    .description(Actions.SYNTHESIZE_STACKS)
    .argument(stageArgument)
    .action(async (stage) => {
        await synthesizeStacks(await getStageOption(stage));
    });

program
    .command("deploy")
    .description(Actions.DEPLOY_STACKS)
    .argument(stageArgument)
    .option("--all", "deploy all stacks without prompting")
    .action(async (stage, options) => {
        await deployStacks(await getStageOption(stage), "deploy", options.all);
    });

program
    .command("hotswap")
    .description(Actions.HOTSWAP_STACKS)
    .argument(stageArgument)
    .option("--all", "hotswap all stacks without prompting")
    .action(async (stage, options) => {
        await deployStacks(await getStageOption(stage), "hotswap", options.all);
    });

program
    .command("deploy-frontend")
    .description(Actions.DEPLOY_FRONTEND)
    .argument(stageArgument)
    .action(async (stage) => {
        await deployFrontendStack(await getStageOption(stage));
    });

program
    .command("refresh-frontend")
    .description(Actions.REFRESH_FRONTEND)
    .argument(stageArgument)
    .action(async (stage) => {
        await createLocalEnvironment(await getStageOption(stage));
    });

if (!cdkContext.accounts) {
    console.error(bold(`Missing account(s) in cdk.json.`));
    bye(1);
}

// interactive mode
if (process.argv.length === 2) {
    console.clear();
    console.log(bold(magentaBright("Welcome to the Demo Starter Kit!")));
    console.log(bold(magentaBright("Created by AWS Technical Product Marketing 🧪")));

    (async () => {
        while (true) {
            const stage = await prompt
                .select("stage", [...Object.keys(cdkContext.accounts), Actions.EXIT])
                .catch(() => Actions.EXIT);

            if (stage === Actions.EXIT) bye(0);

            await ensureCredentials(stage).catch((error) => printError(error));

            while (true) {
                try {
                    const selection = await prompt
                        .select(`action for ${stage}`, Object.values(Actions))
                        .catch(() => Actions.BACK);

                    if (selection === Actions.BACK) {
                        break;
                    } else if (selection === Actions.EXIT) {
                        bye(0);
                    }

                    switch (selection) {
                        case Actions.CONFIGURE_CREDS:
                            await configureCredentials(stage);
                            break;
                        case Actions.CONFIGURE_SECRET:
                            await configureSecret(stage);
                            break;
                        case Actions.BOOTSTRAP_ACCOUNT:
                            await bootstrapAccount(stage);
                            break;
                        case Actions.SYNTHESIZE_STACKS:
                            await synthesizeStacks(stage);
                            break;
                        case Actions.DEPLOY_STACKS:
                            await deployStacks(stage, "deploy");
                            break;
                        case Actions.HOTSWAP_STACKS:
                            await deployStacks(stage, "hotswap");
                            break;
                        case Actions.DEPLOY_FRONTEND:
                            await deployFrontendStack(stage);
                            break;
                        case Actions.REFRESH_FRONTEND:
                            await createLocalEnvironment(stage);
                            break;
                        case Actions.TEST_FRONTEND:
                            await createLocalServer(stage);
                            break;
                        case Actions.MANAGE_USER:
                            await manageUser(stage);
                            break;
                        case Actions.DESTROY_STACKS:
                            await destroyStacks(stage);
                            break;
                    }
                } catch (error) {
                    printError(error as Error);
                }
            }
        }
    })();
} else {
    program.parseAsync().catch((error) => {
        printError(error);
        console.log("");
    });
}
