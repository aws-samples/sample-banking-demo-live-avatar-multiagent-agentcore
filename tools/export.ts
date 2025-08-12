#!/usr/bin/env node

import archiver from "archiver";
import { bold, greenBright } from "chalk";
import { execSync } from "child_process";
import * as fs from "fs";

(async () => {
    const zipName = "export.zip";

    const output = fs.createWriteStream(zipName);
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
                fs.existsSync(file) &&
                !ignorePatterns.some((pattern) =>
                    pattern.endsWith("/") ? file.startsWith(pattern) : file === pattern
                )
        );

    for (const file of files) {
        if (!file.match(/\.(ts|tsx|md|json)$/)) {
            archive.file(file, { name: file });
            continue;
        }

        const lines = fs.readFileSync(file, "utf-8").split("\n");
        let shouldDelete = false;

        for (let i = lines.length - 1; i >= 0; i--) {
            let match;
            if (file.endsWith(".json")) {
                match = lines[i].match(/"@export":\s*(\{[^}]+\})/);
            } else {
                match = lines[i].match(
                    /(?:\/\/\s*@export\s*(\{[^}]+\})|<!--\s*@export\s*(\{[^}]+\})\s*-->)/
                );
            }
            if (!match) continue;

            try {
                const config = JSON.parse(match[1] || match[2]);
                if (config.deleteFile) {
                    shouldDelete = true;
                    break;
                }
                if (config.deleteLines) {
                    lines.splice(i, config.deleteLines + 1);
                }
                if (config.replace && config.with !== undefined) {
                    lines.splice(i, 1);
                    if (i < lines.length && lines[i].includes(config.replace)) {
                        lines[i] = lines[i].replace(config.replace, config.with);
                    }
                }
            } catch {}
        }

        if (!shouldDelete) {
            archive.append(lines.join("\n"), { name: file });
        }
    }

    await archive.finalize();
    console.log(greenBright(bold(`Created ${zipName} at root!\n`)));
})();
