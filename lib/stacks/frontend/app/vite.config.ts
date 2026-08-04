import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Find the hoisted bedrock-agentcore package by walking up from here
function findPackageDir(pkg: string, fromDir: string): string {
    let dir = fromDir;
    while (true) {
        const candidate = path.join(dir, "node_modules", pkg);
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) throw new Error(`Cannot find ${pkg} from ${fromDir}`);
        dir = parent;
    }
}

const dcvSdkDir = path.join(
    findPackageDir("bedrock-agentcore", __dirname),
    "dist/src/tools/browser/live-view/nice-dcv-web-client-sdk"
);

// Note: DCV runtime files (workers, WASM) are synced into public/nice-dcv-web-client-sdk/
// by scripts/sync-dcv-sdk.mjs (runs in predev / prebuild). The BrowserLiveView
// component loads them from the absolute path /nice-dcv-web-client-sdk/dcvjs-esm.

export default defineConfig({
    plugins: [react()],

    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            // DCV SDK bare specifier aliases — required by BrowserLiveView
            dcv: path.resolve(dcvSdkDir, "dcvjs-esm/dcv.js"),
            "dcv-ui": path.resolve(dcvSdkDir, "dcv-ui/dcv-ui.js"),
        },
        // Force shared deps to resolve from this project's node_modules
        dedupe: [
            "react",
            "react-dom",
            // A single `three` instance is required: TalkingHeadAvatar attaches the
            // meshopt decoder to GLTFLoader.prototype, and TalkingHead's internal
            // loader must be that same class (see TalkingHeadAvatar.tsx).
            "three",
            "prop-types",
            "@cloudscape-design/components",
            "@cloudscape-design/global-styles",
            "@cloudscape-design/design-tokens",
            "@babel/runtime",
        ],
    },

    build: {
        outDir: "dist",
        sourcemap: true,
        rollupOptions: {
            output: {
                manualChunks: {
                    "react-vendor": ["react", "react-dom", "react-router-dom"],
                    "ui-vendor": ["@cloudscape-design/components"],
                    "auth-vendor": ["react-oidc-context"],
                    "three-vendor": ["three"],
                    "flow-vendor": ["@xyflow/react"],
                    "animation-vendor": ["animejs"],
                },
            },
        },
    },

    server: {
        port: 3000,
        open: true,
    },
});
