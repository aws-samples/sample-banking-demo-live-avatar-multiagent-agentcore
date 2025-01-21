#!/usr/bin/env ts-node

import chalk from 'chalk';
import enquirer from "enquirer";
import clear from "clear";
import { existsSync, mkdirSync } from "fs";
import colors from 'colors';
import { banner, confirmPrompt, executeCommand, freePortInUse, getProjectConfig, refreshCreds, selectAccountStage, spawnChild, validateConfig, webappHydrateAssetsPath } from "./utils";
import { CredentialsType, deployWebApp, getCrossAccountCredentials, hydrate, setupWebsiteEnvironment } from "./deploy-website";
import { MainOperationEnum, OperationProps } from "./constants";
import { PresetStageType } from "../../shared";


// enable console colors
colors.enable();
// args
const args = process.argv[2];
const argStage = process.argv[3];

const createWebsiteEnvironment = async (stage: string) => {
    const credentials = await getCrossAccountCredentials(stage) as CredentialsType;
    if (credentials) {
        if (!await setupWebsiteEnvironment(credentials, stage)) {
            console.error(`\n🛑 Unable to setup environment. Exiting\n`)
            return null
        }
        return credentials
    } else {
        console.error(`\n 🛑 Unable to get cross account credentials.\n`)
    }
    return null
}

const synthInfra = async (stage: string) => {
    const projectConfigJson = getProjectConfig()
    if (!projectConfigJson) {
        console.error(`\n 🛑 Project config not found. \n`);
        return
    }
    console.log(
        chalk.magenta(`\n Synthesizing CDK Infra to ${stage} account with ADA profile ${projectConfigJson.projectName}-${stage} ... ⌛ \n`)
    );
    try {
        await spawnChild('cdk', ['synth', `--profile`, `${projectConfigJson.projectName}-${stage}`, "--context", `accountName=${stage}`, '--color'])
        console.log(chalk.greenBright(`Infra synthesized successfully for ${stage} account ✅`));
        console.log(chalk.greenBright(`\nℹ️  Listing CDK Stacks ... \n`));
        await spawnChild('cdk', ['ls', `--profile`, `${projectConfigJson.projectName}-${stage}`, "--context", `accountName=${stage}`])
    } catch (err) {
        console.error(`\n 🛑 CDK synthesis  failed.\n`);
    }
}

const handleDeployInfra = async (stage: string) => {
    const projectConfigJson = getProjectConfig()
    if (!projectConfigJson) {
        console.error(`\n 🛑 Project config not found. \n`);
        return
    }
    console.log(
        chalk.magenta(`\n Deploying CDK Infra to ${stage} account with ADA profile ${projectConfigJson.projectName}-${stage} ... ⌛ \n`)
    );
    //  --context will send a custom command line arg to indicate which account we are trying to deploy the changes and CDK will auto resolve stack path and names and 
    try {
        if (projectConfigJson.codePipeline && (stage === PresetStageType.Dev || stage === PresetStageType.Prod)) {
            console.log(chalk.greenBright(`\nℹ️  Pipeline configuration found! Deploying stacks with qualifier ${projectConfigJson.projectName}/${stage}/infra/* \n`));
            await spawnChild('cdk', ['deploy', `-e`, `${projectConfigJson.projectName}/${stage}/infra/*`, stage, '--profile', `${projectConfigJson.projectName}-${stage}`, "--context", `accountName=${stage}`])
        } else {
            console.log(chalk.greenBright(`\nℹ️  Pipeline not configured; deploying stacks with qualifier ${projectConfigJson.projectName}/* \n`));
            await spawnChild('cdk', ['deploy', `-e`, `${projectConfigJson.projectName}/*`, stage, '--profile', `${projectConfigJson.projectName}-${stage}`, "--context", `accountName=${stage}`])
        }
        console.log(chalk.greenBright(`Infra deployed successfully to ${stage} account ✅`));
    } catch (err) {
        console.error(`\n 🛑 Infra deployment failed.\n`);
    }
}

const handleDeployWebApp = async (stage: string) => {
    const projectConfigJson = getProjectConfig()
    if (!projectConfigJson) {
        console.error(`\n 🛑 Project config not found. \n`);
        return
    }
    console.log(
        chalk.magenta(`\n Deploying Web app to ${stage} account with ADA profile ${projectConfigJson.projectName}-${stage} ... ⌛ \n`)
    );
    try {
        const credentials = await createWebsiteEnvironment(stage)
        if (!credentials) {
            console.error(`\n 🛑 Unable to create website environment. Exiting\n`)
            return
        }
        await deployWebApp(credentials, stage)
        console.log(chalk.greenBright(`\nWebsite deployed to ${stage} account ✅ \n`));

    } catch (err) {
        console.log("🚀 ~ handleDeployWebApp ~ err:", err)
        console.error(`\n 🛑 Web app deployment failed.\n`);
    }
}

const serverWebapp = async (stage: string) => {
    try {
        await createWebsiteEnvironment(stage)
        console.log(chalk.greenBright(`\nEnvironment setup verified 🟢 \n`));
        await freePortInUse(3000)
        console.log(chalk.magenta(`\n Serving local website for stage -${stage}... ⌛ \n`));
        if (!await spawnChild('npm', ['run', '-w', 'webapp', 'dev'], { detached: true, })) {
            console.error(`\n🛑 Unable to setup environment. Exiting\n`)
        }
    } catch (err) {
        console.error(`\n 🛑 Serving web app deployment failed.\n`);
    }
}

const destroyCDK = async (stage: string) => {
    const projectConfigJson = getProjectConfig()
    if (!projectConfigJson) {
        console.error(`\n 🛑 Project config not found. \n`);
        return
    }
    try {
        await refreshCreds(stage)
        console.log(
            chalk.magenta(`\n Listing CDK Infra at ${stage} stage ... ⌛ \n`)
        );
        const stacksList = await executeCommand(`npm run -w infra cdk-list`) as string
        let stacks = stacksList.split("\n").map(stack => stack.replace("\x1B[39m'", "").replace("\x1B[37m", "").split(" ")[0])
        stacks.unshift(`${projectConfigJson.projectName}/${stage}-root`)
        const stackOperations = [
            {
                type: "autocomplete",
                name: "opr",
                message: "Select an option using arrow keys or type stack name and hit enter to execute -",
                choices: stacks.filter(s => s.includes(stage))
            },
        ];
        clear()
        await enquirer.prompt(stackOperations).then(async (ans: object) => {
            const selection = ans as OperationProps
            if (selection.opr) {
                console.log(chalk.yellowBright(`\n 🚨 This will delete the ${selection.opr} stack from your ${stage} stage.\n\nThis action is NOT REVERSIBLE.\n\nAre you sure you want to continue?`));
                const choice = await confirmPrompt();
                if (!choice) {
                    console.log(chalk.magenta(`\n 😑 CDK destroy cancelled.\n`));
                    return
                }
                if (selection.opr === `${projectConfigJson.projectName}/${stage}-root`) {
                    console.log(chalk.magenta(`\n CDK destroying root stack for ${projectConfigJson.projectName} ... ⌛ \n`));
                    await spawnChild('cdk', ['destroy', "--app='npx ts-node bin/infra.ts'", '-f', '--profile', `${projectConfigJson.projectName}-${stage}`])

                } else {
                    console.log(chalk.magenta(`\n CDK destroying stack - ${selection.opr} exclusively for ${projectConfigJson.projectName} with stage - ${stage}... ⌛ \n`));
                    await spawnChild('cdk', ['destroy', '-e', selection.opr, '-f', '--profile', `${projectConfigJson.projectName}-${stage}`])
                }
                console.log(chalk.greenBright(`Infra destroyed successfully for ${stage} account ✅\n\nSome assets may be retained please clean up manually using AWS Management Console!\n\n`));
            }
        })
    } catch (err) {
        console.error(`\n 🛑 CDK destroy failed.\n`);
    }
}

export const operations = async () => {
    const mainOperations = [
        {
            type: "autocomplete",
            name: "opr",
            message: "Select an option using arrow keys or type option number and hit enter to execute -",
            choices: Object.values(MainOperationEnum).map((item: string, index: number) => `${index + 1}. ${item} `)
        },
    ];
    try {
        await enquirer.prompt(mainOperations).then(async (ans: object) => {
            const selection = ans as OperationProps
            if (selection.opr.includes(MainOperationEnum.REFRESH_CREDS)) {
                const stage = await selectAccountStage();
                if (!stage) {
                    console.error(`\n 🛑 Account stage not found.\n`);
                    return
                }
                await refreshCreds(stage)
            } else if (selection.opr.includes(MainOperationEnum.SYNTH_INFRA)) {
                const stage = await selectAccountStage();
                if (!stage) {
                    console.error(`\n 🛑 Account stage not found.\n`);
                    return
                }

                await synthInfra(stage)
            } else if (selection.opr.includes(MainOperationEnum.DEPLOY_INFRA)) {
                const stage = await selectAccountStage();
                if (!stage) {
                    console.error(`\n 🛑 Account stage not found.\n`);
                    return
                }

                await synthInfra(stage)
                await handleDeployInfra(stage)
            } else if (selection.opr.includes(MainOperationEnum.DEPLOY_WEBAPP)) {
                const stage = await selectAccountStage();
                if (!stage) {
                    console.error(`\n 🛑 Account stage not found.\n`);
                    return
                }

                await handleDeployWebApp(stage)
            } else if (selection.opr.includes(MainOperationEnum.DEPLOY_ALL)) {
                const stage = await selectAccountStage();
                if (!stage) {
                    console.error(`\n 🛑 Account stage not found.\n`);
                    return
                }
                try {

                    await synthInfra(stage)
                    await handleDeployInfra(stage)
                    await handleDeployWebApp(stage)
                } catch (err) {
                    console.error(`\n 🛑 Deployments failed.\n`);
                }
            } else if (selection.opr.includes(MainOperationEnum.REFRESH_LOCAL_ENV)) {
                console.log(chalk.green('\n Refetching environments ... ⌛ \n'));
                const stage = await selectAccountStage();
                if (!stage) {
                    console.error(`\n 🛑 Account stage not found.\n`);
                    return
                }

                await createWebsiteEnvironment(stage)
            }
            else if (selection.opr.includes(MainOperationEnum.SERVE_WEBAPP)) {
                const stage = await selectAccountStage();
                if (!stage) {
                    console.error(`\n 🛑 Account stage not found.\n`);
                    return
                }
                // don't use await here else this will never return
                serverWebapp(stage)
                console.log(chalk.greenBright(`\nserving local website ✅ \n`));
            } else if (selection.opr.includes(MainOperationEnum.HYDRATE)) {
                const stage = await selectAccountStage();
                if (!stage) {
                    console.error(`\n 🛑 Account stage not found.\n`);
                    return
                }

                //  check if folder exists 
                if (existsSync(webappHydrateAssetsPath)) {
                    console.log(chalk.greenBright(`Starting hydration of data bucket for ${stage} 🟢\n`));
                    const credentials = await getCrossAccountCredentials(stage) as CredentialsType;
                    await hydrate(credentials, stage)
                } else {
                    mkdirSync(webappHydrateAssetsPath)
                    console.log(chalk.magentaBright(`\n 🤔 Hydration folder not found.We have created one for you at - \n ${webappHydrateAssetsPath} \n place your files there & try again.\n`));
                }

            }
            else if (selection.opr.includes(MainOperationEnum.DELETE_CDK_STACK)) {
                const stage = await selectAccountStage();
                if (!stage) {
                    console.error(`\n 🛑 Account stage not found.\n`);
                    return
                }
                await destroyCDK(stage)


            }
            else if (selection.opr.includes(MainOperationEnum.EXIT)) {
                clear();
                await freePortInUse(3000)
                console.log(chalk.green('\n 👋 Good bye!! \n'));
                // free any ports running 
                setTimeout(async () => {
                    process.exit(0);
                }, 1500)
            }
            else {
                console.log(chalk.redBright('\n 🤔 Unknown operation. Please try again! \n'));
            }

            setTimeout(() => {
                operations();
            }, 3500)

        });
    } catch (err) {
        main()
    }
}

export const main = async () => {
    // kyber can also run in standalone mode by taking in CLI args
    // we check for args & stage name first
    // if no CLI args are provided we show the list


    if (args && argStage) {
        console.log(`🚀 Received args: ${args} - switching to execution mode`)
        if (args === "deploy-website") {
            console.log(`🚀 Deploying web app to: ${argStage} `)
            await handleDeployWebApp(argStage)
        }
    } else {
        clear();
        banner();
        // verifications 
        validateConfig();
        operations();
    }
}

main();




