#!/usr/bin/env ts-node

import chalk from 'chalk';
import { clear } from "console";
import colors from 'colors';
import { banner, confirmPrompt, executeCommand, getProjectConfig, getSecretPrompt, goodBye, projectConfigPath, refreshCreds, spawnChild, validateConfig } from "./utils"

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { PresetStageType, AccountType, AccountObjectType } from "../../shared";
// enable console colors
colors.enable();

export const updateMidwaySecretID = async (accountName: string, midwaySecretID: string) => {
    try {
        if (!existsSync(projectConfigPath)) {
            console.error(`\n 🛑 Project configuration not found. Skipping\n`);
            return false
        }
        const projectConfigJson = JSON.parse(readFileSync(projectConfigPath, {
            encoding: 'utf-8'
        }))

        projectConfigJson["account"][accountName] = {
            ...projectConfigJson["account"][accountName],
            midwaySecretID
        }

        console.log("🚀 Project Config Formed:", projectConfigJson)
        writeFileSync(projectConfigPath, JSON.stringify(projectConfigJson, null, 4))
        return true
    } catch (error) {
        console.error(`\n 🛑 Error updating Midway secret for account - ${accountName}\n`);
        return false
    }
}


export const createAdaProfile = async (accountNumber: string, profileName: string) => {
    if (!await executeCommand(`ada profile print --profile=${profileName}`)) {
        console.log(chalk.magenta(`\nCreating a new ADA profile ${profileName}...⌛ \n`))
        if (await executeCommand(`ada profile add --profile=${profileName} --account=${accountNumber} --provider=isengard --role=Admin`)) {
            console.log(chalk.greenBright(`Added new profile - ${profileName} ✅`));
        } else {
            console.error(`\n 🛑 Error creating ADA profile for - ${profileName}\n`);
            goodBye()
        }
    } else {
        console.log(chalk.greenBright(`\n ADA profile already exists for profile - ${profileName} mapped to account - (${accountNumber}) 🟢\n`));
    }
}

export const bootstrapAccount = async (account: AccountType, stage: string) => {
    console.log(chalk.magenta(`\nBootstrapping account - ${account.number} - region ${account.region} for stage - ${stage}... ⌛ \n`));
    const projectConfigJson = getProjectConfig()
    if (!projectConfigJson) {
        console.error(`\n 🛑 Project config not found. \n`);
        return
    }
    try {
        if (stage === PresetStageType.Prod) {
            // enable termination protection & trust dev account
            const devAccountNumber = projectConfigJson.account[PresetStageType.Dev]?.number
            if (!devAccountNumber) {
                console.error(`\n 🛑 Dev account not found. Skipping\n`);
                goodBye()
                return
            }
            console.log(chalk.magenta(`\n💡 Enabling termination protection for ${stage} account -(${account.number}) and setting up trust with dev account - ${devAccountNumber} \n`));
            await spawnChild('cdk', ['bootstrap', `aws://${account.number}/${account.region}`, '--cloudformation-execution-policies', 'arn:aws:iam::aws:policy/AdministratorAccess', '--termination-protection', '--trust', devAccountNumber,
                '--profile', `${projectConfigJson.projectName}-${stage}`])
            await spawnChild('cdk', ['bootstrap', `aws://${account.number}/us-east-1`, '--cloudformation-execution-policies', 'arn:aws:iam::aws:policy/AdministratorAccess', '--termination-protection', '--trust', devAccountNumber,
                '--profile', `${projectConfigJson.projectName}-${stage}`])

        } else {
            await spawnChild('cdk', ['bootstrap', `aws://${account.number}/${account.region}`, '--cloudformation-execution-policies', 'arn:aws:iam::aws:policy/AdministratorAccess', '--profile', `${projectConfigJson.projectName}-${stage}`])
            // perform the similar action to us-east-1 as we have a regional WAF  + Cloudfront deployment
            await spawnChild('cdk', ['bootstrap', `aws://${account.number}/us-east-1`, '--cloudformation-execution-policies', 'arn:aws:iam::aws:policy/AdministratorAccess', '--profile', `${projectConfigJson.projectName}-${stage}`])
        }

    } catch (err) {
        console.error(chalk.red(`\n🛑 Error bootstrapping account  ${stage} account - ${account.number} \n`));
        goodBye()
    }
}


const createMidwaySecret = async (account: AccountType, stage: string) => {
    console.log(chalk.magenta(`\nVerifying account - ${account.number}. Please wait ... ⌛ \n`));
    const projectConfigJson = getProjectConfig()
    if (!projectConfigJson) {
        console.error(`\n 🛑 Project config not found. \n`);
        return
    }

    try {
        const describeSecretRespJson = JSON.parse(await executeCommand(`aws secretsmanager describe-secret --secret-id ${projectConfigJson.projectName}-midway-secret --region ${account.region} --profile=${projectConfigJson.projectName}-${stage}`))
        let arnPart = describeSecretRespJson ? describeSecretRespJson["ARN"].split("-").pop() : ""
        let secret = "NONE"
        if (arnPart === "") {
            console.log(chalk.blueBright(`\nMidway Secret not found. Let's create a new Midway secret for ${projectConfigJson.projectName}-${stage}\n`))
            if (stage === PresetStageType.Dev || stage === PresetStageType.Prod) {
                do {
                    if (secret !== "NONE" && secret.length < 40) {
                        console.error(chalk.red(`\n🛑 Invalid Midway Token. Token length must be at least 40 characters long. Try again ... \n`));
                    }
                    secret = await getSecretPrompt(`Paste the Midway secret token for ${stage} account - ${account.number}`)
                } while (secret.length < 40)
            } else {
                // get secret value from dev account 
                console.log(chalk.magenta(`\n↪️ Sandbox Account detected.\nGetting Midway secret from dev account ... ⌛ \n`));
                const devAccount = projectConfigJson.account[PresetStageType.Dev]
                if (!devAccount) {
                    console.error(`\n 🛑 Dev account not found. Skipping\n`);
                    goodBye()
                    return
                }
                const devSecretResponse = JSON.parse(await executeCommand(`aws secretsmanager get-secret-value --secret-id ${projectConfigJson.projectName}-midway-secret --region ${devAccount.region} --profile=${projectConfigJson.projectName}-${PresetStageType.Dev}`))

                console.log("🚀 ~ createMidwaySecret ~ devSecretResponse:", devSecretResponse)
                // get secret value
                secret = JSON.parse(devSecretResponse["SecretString"])["clientID"]

            }
            console.log(chalk.greenBright(`\n✅ Got valid secret key. Continuing ...`));

            const secretJSONString = `"{\\"clientID\\":\\"${secret}\\"}"`

            const secretResponse = JSON.parse(await executeCommand(`aws secretsmanager create-secret --name ${projectConfigJson.projectName}-midway-secret --region ${account.region} --description "Midway auth secret" --secret-string ${secretJSONString} --profile=${projectConfigJson.projectName}-${stage}`))
            arnPart = secretResponse["ARN"].split("-").pop()
        } else {
            console.log(chalk.greenBright(`\nMidway Secret already exists for - ${projectConfigJson.projectName}-${stage} .. moving on 🟢\n`));
        }
        // update the secret ARN part to config file
        updateMidwaySecretID(stage, arnPart)
        console.log(chalk.greenBright(`\nMidway Secret created successfully created for - ${projectConfigJson.projectName}-${stage} ✅ \n`));

    } catch (err) {
        console.log(chalk.red(`🛑 Error creating Midway profile - ${projectConfigJson.projectName} - ${stage}\n`));
    }
}


const initProject = async (stage: string) => {
    console.log(chalk.magenta(`\nInitializing - ${stage} account ...⌛ \n`))
    const projectConfigJson = getProjectConfig()
    if (!projectConfigJson) {
        console.error(`\n 🛑 Project config not found. \n`);
        return
    }
    const account = projectConfigJson.account[stage]
    if (!account) {
        // dev account is mandatory so exit the setup if config is missing
        console.error(`\n 🛑 ${stage} account configuration not found. \n`);
        goodBye()
        return
    }
    const devAccount = projectConfigJson.account[PresetStageType.Dev];
    if (!devAccount) {
        // dev account is mandatory so exit the setup if config is missing
        console.error(`\n 🛑 Dev account configuration not found \n`);
        goodBye()
        return
    }

    // set default region 
    if (await executeCommand(`aws configure set default.region ${account.region} && aws configure set default.output json`)) {
        console.log(chalk.greenBright(`\n Default region set to - ${account.region} 🟢\n`));
    } else {
        console.log(chalk.red(`\n🛑  Error setting default region \n`));
        goodBye()
    }

    // 1. Set up ADA profile
    console.log(chalk.cyan(`\n📖 Setting up ADA profiles for - ${projectConfigJson.projectName}\n`));
    await createAdaProfile(account.number, `${projectConfigJson.projectName}-${stage}`)


    // 2. bootstrap account
    console.log(chalk.cyan(`\n🥾 Bootstrapping accounts - ${projectConfigJson.projectName} \n`));
    await bootstrapAccount(account, stage)


    // 3. Midway Configuration 
    if (projectConfigJson.midway) {
        console.log(chalk.cyan(`\n🔑 Midway Configurations for - ${projectConfigJson.projectName}\n`));

        await createMidwaySecret(account, stage)

    } else {
        console.log(chalk.yellow(`\n ↪️ Skipping Midway Secret setup as per configuration.\n`));
    }


}

const main = async () => {
    try {
        clear();
        banner();
        // schema validations 
        validateConfig();
        const projectConfigJson = getProjectConfig()
        if (!projectConfigJson) {
            console.error(`\n 🛑 Project config not found. \n`);
            return
        }

        console.log(chalk.blueBright(`\nPlease verify the following before proceeding -
        \nProject Name - ${projectConfigJson.projectName} \n`));

        // verify if at least dev account is present
        const devAccount = projectConfigJson.account[PresetStageType.Dev]
        if (!devAccount) {
            console.error(`\n 🛑 Dev account configuration not found \n`);
            goodBye()
            return
        }
        console.log(chalk.blueBright(`Dev Account Number - ${devAccount.number} \nDev Account Region - ${devAccount.region}\n`));

        // get dev account credentials first  
        console.log(chalk.cyan(`\n Refreshing ${PresetStageType.Dev} credentials... ⌛ \n`));
        // a central CodeArtifact allowlisted account profile to act as a backup in case the dev/prod accounts are not on-boarded/whitelisted to use CodeArtifact
        // see guide here on CodeArtifact account onboarding - https://docs.hub.amazon.dev/codeartifact/user-guide/
        await createAdaProfile("010526252695", "code-artifact")

        await refreshCreds(PresetStageType.Dev)

        // get user choice to proceed
        const choice = await confirmPrompt();
        if (choice) {

            console.log(chalk.greenBright(`\nInitializing project - ${projectConfigJson.projectName} \n`));
            // must read from file as symbolic import will have references and may have wrongly arranged account types

            const accounts: AccountObjectType = projectConfigJson["account"]
            const stages = Object.keys(accounts)

            for (const stage of stages) {
                await initProject(stage)
            }

            let isMidwayUpdated = false

            // remove midwaySecretID from accounts object 
            for (const stage of stages) {
                if (!projectConfigJson["midway"]) {
                    delete accounts[stage]["midwaySecretID"]
                    isMidwayUpdated = true
                }
            }

            if (isMidwayUpdated) {
                projectConfigJson.account = accounts
                writeFileSync(projectConfigPath, JSON.stringify(projectConfigJson, null, 4))
                console.log(chalk.greenBright(`\n Project Config file updated. 🟢\n`));
            }

            // Deploying Pipeline to Dev account 
            if (projectConfigJson.codePipeline) {
                console.log(chalk.magenta(`\n🧪 Setting up Pipeline in Dev account ... ⌛ \n`));
                try {
                    await spawnChild('cdk', ['deploy', '-e', `${projectConfigJson.projectName}`, '--profile', `${projectConfigJson.projectName}-${PresetStageType.Dev}`])
                    console.log(chalk.greenBright(`Pipeline is setup in Dev account ✅`));
                } catch (err) {
                    console.error(`\n 🛑 Pipeline setup failed.\n`);
                    goodBye()
                }
            } else {
                // skip for prod & sandbox accounts
                console.log(chalk.yellow(`\n ↪️ Skipping CodePipeline CI / CD setup \n`));
            }


            console.log(chalk.green('\n Initialized project successfully! ✅  \n'));
        } else {
            console.log(chalk.red('\n 🛑 Exiting now...\n'));
        }
        // exit gracefully 
        goodBye(0)
    } catch (err) {
        console.log(chalk.red('\n 🛑 Aborting!! \n'));
        goodBye()
        // exit with error 
    }
}


main()



