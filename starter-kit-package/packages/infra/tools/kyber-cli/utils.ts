import chalk from "chalk";
import figlet from "figlet";
import { spawn, SpawnOptionsWithoutStdio } from "child_process";
import util from 'util';
import enquirer from "enquirer";
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { z } from "zod";
import { join, resolve } from 'path';

import { AccountObjectType, PresetStageType, ProjectConfigType, SelectPresetStageType } from "../../shared"
const exec = util.promisify(require('child_process').exec);
// location of project config file 
export const projectConfigPath = resolve(__dirname, '..', '..', '..', 'config', 'project-config.json');

// location where the env file will be created
export const envPath = resolve(__dirname, '..', '..', '..', '..', 'webapp', 'src', '.env');

// location of web app dist folder
export const webappDistPath = resolve(__dirname, '..', '..', '..', '..', 'webapp', 'dist');

// webapp assets path - static assets to be served 
export const webappStaticAssetsPath = resolve(__dirname, '..', '..', '..', '..', 'webapp', 'src', 'static');

// webapp hydrate folder path - hydration to data bucket
export const webappHydrateAssetsPath = resolve(__dirname, '..', '..', '..', '..', 'webapp', 'src', 'hydration');

// graphql codegen configs
export const graphQLConfigTemplate = resolve(__dirname, '..', '..', '..', '..', 'webapp', 'gql_config_template.yml')

export const graphQLConfigFilePath = resolve(__dirname, '..', '..', '..', '..', 'webapp', '.graphqlconfig.yml')

export const refreshCreds = async (stage: string) => {
    const projectConfigJson = getProjectConfig()
    if (!projectConfigJson) {
        console.error(`\n 🛑 Project config not found. \n`);
        return
    }
    const account = projectConfigJson.account[stage]
    if (!account) {
        console.error(`\n 🛑 Account not found. \n`);
        return
    }
    // set default region 
    if (await executeCommand(`aws configure set default.region ${account.region} && aws configure set default.output json`)) {
        console.log(chalk.greenBright(`\n Default region set to - ${account.region} 🟢\n`));
    } else {
        console.log(chalk.red(`\n🛑  Error setting default region to - ${account.region}.\n`));
        return
    }
    console.log(chalk.magenta(`\n Refreshing ${stage} credentials... ⌛ \n`));
    if (await executeCommand(`ada credentials update --provider=isengard --role Admin --once --account=${account?.number}`)) {
        console.log(chalk.greenBright(`\n Credentials updated for ${stage} with account number  - ${account?.number} 🟢\n`));
    } else {
        console.log(chalk.red(`\n🛑  Error updating credentials for ${stage} with account number - ${account?.number}.\n`));
        return
    }

    // try getting CodeArtifact login with dev account
    if (!projectConfigJson.codeArtifact) {
        console.log(chalk.magenta(`\n↪️  CodeArtifact config turned off in project config. Skipping ...\n`))
        if (!await executeCommand("cd ../.. && npm config set registry=https://registry.npmjs.com/"))
            console.log(chalk.red(`\n🛑  Error updating NPM registry. Try again!\n`));
    } else {
        console.log(chalk.magenta('\n Authenticating with CodeArtifact ... ⌛ \n'));
        if (!await executeCommand(`cd ../.. && aws codeartifact login --tool npm --repository shared --domain amazon --domain-owner 149122183214 --region us-west-2 --profile ${projectConfigJson.projectName}-${PresetStageType.Dev}`)) {
            console.log(chalk.red('\n ✋🏼 Error authenticating with CodeArtifact using dev account. Retrying with central account. \n'));
            if (await executeCommand(`cd ../.. && aws codeartifact login --tool npm --repository shared --domain amazon --domain-owner 149122183214 --region us-west-2 --profile code-artifact`)) {
                console.log(chalk.greenBright(`\n CodeArtifact login successful with central account 🟢\n`));
            } else {
                console.log(chalk.red('\n🛑  Error authenticating with CodeArtifact using central account.\n'));
                return
            }
        } else {
            console.log(chalk.greenBright(`\n CodeArtifact login successful with dev account 🟢\n`));
        }
    }

}

export const goodBye = (exitCode: number = 1) => {
    console.log(chalk.green('\n 👋 Good bye!! \n'));
    // default exit code is 1 to indicate error pass 0 to exit gracefully 
    process.exit(exitCode);
}


export const executeCommand = async (instr: string) => {
    try {
        const { error, stdout, stderr } = await exec(instr);
        if (error) {
            console.error(`exec error: ${JSON.stringify(error)}`);
            console.log(`stderr: ${stderr}`);
        }
        console.log(chalk.magenta(stdout));
        return stdout && stdout.length > 0 ? stdout.trim() : "success"
    } catch (err: any) {
        // console.info(err)
        console.log(chalk.yellow(`\n Error - ${JSON.stringify(err.stderr)}\n`));
    }
    return null;
}


export const spawnChild = (instr: string, args?: readonly string[], options?: SpawnOptionsWithoutStdio) => {
    return new Promise((resolve, reject) => {
        const child = spawn(instr, args, { ...options, shell: false });
        // print command output
        child.stdout.on('data', (data) => {
            console.log(chalk.blue(`${data.toString()}`));
        });
        // this will print console errors identified
        child.stderr.on('data', (data) => {
            console.log(chalk.cyan(`${data.toString()}`));
        });
        // Centralized error handling
        child.on('error', (err) => {
            console.error(`Child process error: ${err}`);
            reject(new Error(`Child process error: ${err}`));
        });
        child.on('close', (code, signal) => {
            const respPayload = JSON.stringify({
                "command": instr,
                "args": args,
                "options": options,
                "code": code,
                "signal": signal
            })
            if (code !== 0) {
                const error = new Error(respPayload)
                reject(error);
            } else {
                resolve(respPayload);
            }
        });
    })
}

export const banner = async () => {
    console.log(chalk.blue(figlet.textSync("GenAI Labs", {
        font: 'Star Wars',
        horizontalLayout: 'default',
        verticalLayout: 'default',
        whitespaceBreak: false
    }
    )));

    console.log(
        chalk.cyanBright(
            "\n\t Welcome to the Kyber CLI 💎\n"
        )
    );
    console.log(
        chalk.white(
            "\t Made with 💖 from Gen-AI Labs Team.\n"
        )
    );
}

export type ConfirmPromptType = {
    choice: boolean
}

export const confirmPrompt = async (message: string = "Are you sure you want to continue -") => {
    const confirm = {
        type: "toggle",
        name: "choice",
        message,
        enabled: 'Yes',
        disabled: 'No'
    }
    return await enquirer.prompt(confirm).then((response: object) => {
        const responseObj = response as ConfirmPromptType
        return responseObj.choice
    })
}

type MidwaySecretPromptType = {
    "secret": string
}
export const getSecretPrompt = async (message: string = "Paste the Midway secret token -") => {
    const confirm = {
        type: "password",
        name: "secret",
        message,
    }
    return await enquirer.prompt(confirm).then((response: object) => {
        const responseObj = response as MidwaySecretPromptType
        return responseObj.secret
    })
}




export const selectAccountStage = async (message: string = "Select an account -") => {
    const projectConfigJson = getProjectConfig()
    if (!projectConfigJson) {
        console.error(`\n 🛑 Project config not found. \n`);
        return
    }
    const accountSelectionPrompt = {
        type: "select",
        name: "stage",
        message,
        choices: Object.keys(projectConfigJson.account)
    }
    return await enquirer.prompt(accountSelectionPrompt).then((response: object) => {
        const responseObj = response as SelectPresetStageType
        if (responseObj.stage) {
            return responseObj.stage
        } else {
            return null
        }
    })
}

export function* readAllFiles(dir: string): Generator<string> {
    console.log("🚀 ~ function*readAllFiles ~ dir:", dir)
    const files = readdirSync(dir, { withFileTypes: true });

    for (const file of files) {
        if (file.isDirectory()) {
            yield* readAllFiles(join(dir, file.name));
        } else {
            yield join(dir, file.name);
        }
    }
}

export const freePortInUse = async (port: number) => {
    const pid = await executeCommand(`lsof -i :${port} | grep LISTEN | awk '{print $2}'`)
    if (!pid.includes("success")) {
        console.log(chalk.magenta(`\n ✋ Port ${port} not free - pid: ${pid} ... ⌛ \n`));
        if (!await executeCommand(`kill ${pid}`)) {
            console.log(chalk.red(`\n🛑 Error freeing port ${port}.\n`));
        }
        console.log(chalk.magenta(`\n ✅ Port ${port} freed! \n`));

    }
}

export const validateConfig = () => {
    // all properties are required by default

    try {
        const configSchema = z.object({
            projectName: z.string().min(5).max(15).refine((value: string) => !(/[ `!@#$%^&*()_+=\[\]{};':"\\|,.<>\/?~]/.test(value ?? "")), { message: "Name should contain only alphabets except '-' " }),
            gitlabGroup: z.string().min(5).max(35),
            gitlabProject: z.string().min(5).max(35),
            codeArtifact: z.boolean(),
            codePipeline: z.boolean(),
            midway: z.boolean(),
            account: z.record(
                z.string(),
                z.object({
                    number: z.string().length(12),
                    region: z.string(),
                    midwaySecretID: z.string().optional()
                }))
        })


        const projectConfigJson = getProjectConfig()
        if (!projectConfigJson) {
            console.error(`\n 🛑 Project config not found. \n`);
            return
        }

        const result = configSchema.safeParse(projectConfigJson)

        if (!result.success) {
            console.log(chalk.red(`\n🛑 Malformed Project Config.\n`));
            console.error("Schema:", JSON.stringify(result, null, 4))
            goodBye()
        }

        if (!projectConfigJson.account[PresetStageType.Dev]) {
            console.log(chalk.red(`\n🛑 Dev account configuration not found.\n`));
            goodBye()
        }

        // re-arrange object keys such that "dev" in always first 
        const rearrangedStages = [PresetStageType.Dev, ...Object.keys(projectConfigJson.account).filter((key) => key !== PresetStageType.Dev)]
        let rearrangedAccounts: AccountObjectType = {}
        rearrangedStages.forEach((stage: string) => {
            const account = projectConfigJson.account[stage]
            if (account) {
                rearrangedAccounts[stage] = account
            }
        })

        writeFileSync(projectConfigPath, JSON.stringify(projectConfigJson, null, 4))
        console.log(chalk.greenBright(`\n Valid Project Config file for project ${projectConfigJson.projectName} 🟢\n`));
        return true
    } catch (err) {
        console.log("🚀 ~ validateConfig ~ err:", err)
        goodBye()
    }
    return false
}

export const getProjectConfig = (path?: string) => {
    try {
        const config = JSON.parse(readFileSync(path ?? projectConfigPath, {
            encoding: 'utf-8'
        })) as ProjectConfigType

        return config

    } catch (err) {
        console.log(chalk.red(`\n🛑 Unable to get Project Config. Check if file exists.\n`));
        goodBye()
    }
    return null

}