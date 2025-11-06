#!/usr/bin/env node

import archiver from "archiver";
import { bold, greenBright } from "chalk";
import { execSync } from "child_process";
import { Command } from "commander";
import { createWriteStream, existsSync, readFileSync } from "fs";

const exportZip = async (ids: string[] = []) => {
    const zipName = "export.zip";

    const output = createWriteStream(zipName);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(output);

    // ignores .gitignore and below patterns
    const ignorePatterns = [zipName, "tools/export.ts", "docs/kit/images/"];
    const files = execSync("git ls-files --cached --others --exclude-standard", {
        encoding: "utf-8",
    })
        .split("\n")
        .filter(
            (file) =>
                existsSync(file) &&
                !ignorePatterns.some((pattern) =>
                    pattern.endsWith("/") ? file.startsWith(pattern) : file === pattern
                )
        );

    for (const file of files) {
        if (!file.match(/\.(ts|tsx|md|json|yml|yaml)$/)) {
            archive.file(file, { name: file });
            continue;
        }

        const lines = readFileSync(file, "utf-8").split("\n");
        let shouldDelete = false;

        for (let i = lines.length - 1; i >= 0; i--) {
            const match = lines[i].match(
                /(?:\/\/\s*@export\s*(\{[^}]+\})|<!--\s*@export\s*(\{[^}]+\})\s*-->|#\s*@export\s*(\{[^}]+\})|"@export":\s*(\{[^}]+\}))/
            );
            if (!match) continue;

            try {
                const config = JSON.parse(match[1] || match[2] || match[3] || match[4]);

                if (!config.id || ids.includes(config.id)) {
                    if (config.deleteFile) {
                        shouldDelete = true;
                        break;
                    }
                    if (config.deleteLines) {
                        lines.splice(i, config.deleteLines);
                    }
                    if (config.replace && config.with !== undefined) {
                        if (i + 1 < lines.length && lines[i + 1].includes(config.replace)) {
                            lines[i + 1] = lines[i + 1].replace(config.replace, config.with);
                        }
                    }
                }
            } catch {
            } finally {
                lines.splice(i, 1);
            }
        }

        if (!shouldDelete) {
            archive.append(lines.join("\n"), { name: file });
        }
    }

    await archive.finalize();
    console.log(greenBright(bold(`Created ${zipName} at root!\n`)));
};

const program = new Command();
program
    .name("export")
    .description("Export project files with @export tag processing")
    .option(
        "-i, --id <id>",
        "filter export tags by ID (repeatable)",
        (value: string, previous: string[]) => {
            return previous ? [...previous, value] : [value];
        },
        []
    )
    .action((options) => {
        exportZip(options.id);
    });
program.parse();
