#!/usr/bin/env node
/**
 * npm run diagram — regenerate architecture.drawio.png
 *
 * Usage:
 *   npm run diagram                   # stage=dev, live Bedrock call
 *   npm run diagram -- --stage prod
 *   npm run diagram -- --dry-run      # prints the resolved spec, no Bedrock
 *   npm run diagram -- --target agentcore-2026
 *
 * Picks up the project's already-provisioned uv .venv (populated by
 * `npm install` via the postinstall step).
 */
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { resolve } from "node:path";

// This package is CommonJS (no "type": "module" in the root package.json), so
// `__dirname` is available directly under tsx. Deriving it from
// `import.meta.url` instead fails `tsc` with TS1343 under "module": "CommonJS".

const { values } = parseArgs({
    allowPositionals: false,
    options: {
        stage: { type: "string", default: "dev" },
        target: { type: "string", default: "research-agent" },
        "dry-run": { type: "boolean", default: false },
    },
});

const toolkit = resolve(__dirname, "generative-architecture");
const python = resolve(__dirname, "..", ".venv", "bin", "python3");

const args = values["dry-run"]
    ? ["research_agent_config.py", "--stage", values.stage!]
    : ["gen_arch.py", "--target", values.target!, "--stage", values.stage!];

const { status } = spawnSync(python, args, {
    cwd: toolkit,
    stdio: "inherit",
});
process.exit(status ?? 0);
