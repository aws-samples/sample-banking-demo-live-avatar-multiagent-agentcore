import chalk from 'chalk';
import { join, resolve } from 'path';
import { rimraf } from 'rimraf'
import { clear } from "console";
import { confirmPrompt, banner } from "./utils";

const cleanNodeModules = async () => {
    try {
        clear();
        banner();
        const choice = await confirmPrompt("This will delete all node_modules from this project. Are you sure you want to proceed?");
        if (choice) {
            const root_folder = resolve(__dirname, "..", "..", "..", "..", "..");
            const infraRoot = root_folder + "/packages/infra"
            const webAppRoot = root_folder + "/packages/webapp"

            console.log(chalk.magenta(`\n starting clean- up Please wait ... ⌛ \n`));
            rimraf.sync(join(root_folder, "node_modules"))
            rimraf.sync(join(infraRoot, "node_modules"))
            rimraf.sync(join(webAppRoot, "node_modules"))
            // delete package.lock json file 
            rimraf.sync(join(root_folder, "package-lock.json"))
            console.log(chalk.greenBright("Cleaned up all node_modules ✅\n You may re-install fresh packages using `npm i` command from project."));
        }
        else {
            console.log(chalk.red('\n 🛑 Exiting now...\n'));
        }
    } catch (err) {
        console.log(chalk.red(`\n🛑 Failed to clean node_modules.\n`));
    }

    return false;
}

cleanNodeModules()