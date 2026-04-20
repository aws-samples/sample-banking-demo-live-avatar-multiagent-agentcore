#!/usr/bin/env node
/**
 * Sync the NICE DCV Web Client SDK from the hoisted bedrock-agentcore package
 * into public/nice-dcv-web-client-sdk/ so Vite serves it verbatim in both dev
 * and production builds. Required by the BrowserLiveView component, which
 * loads workers/WASM from the absolute path /nice-dcv-web-client-sdk/dcvjs-esm.
 *
 * viteStaticCopy cannot be used here because it preserves the source's
 * absolute directory tree in the output, which puts files under
 * dist/nice-dcv-web-client-sdk/node_modules/... instead of the expected
 * dist/nice-dcv-web-client-sdk/dcvjs-esm path.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findPackageDir(pkg, fromDir) {
    let dir = fromDir;
    while (true) {
        const candidate = path.join(dir, "node_modules", pkg);
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) throw new Error(`Cannot find ${pkg} from ${fromDir}`);
        dir = parent;
    }
}

const src = path.join(
    findPackageDir("bedrock-agentcore", __dirname),
    "dist/src/tools/browser/live-view/nice-dcv-web-client-sdk"
);
const dest = path.resolve(__dirname, "..", "public/nice-dcv-web-client-sdk");

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`Synced DCV SDK: ${src} -> ${dest}`);
