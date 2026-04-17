import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
// Find the hoisted bedrock-agentcore package by walking up from here
function findPackageDir(pkg, fromDir) {
    var dir = fromDir;
    while (true) {
        var candidate = path.join(dir, "node_modules", pkg);
        if (fs.existsSync(candidate)) return candidate;
        var parent_1 = path.dirname(dir);
        if (parent_1 === dir) throw new Error("Cannot find ".concat(pkg, " from ").concat(fromDir));
        dir = parent_1;
    }
}
var dcvSdkDir = path.join(
    findPackageDir("bedrock-agentcore", __dirname),
    "dist/src/tools/browser/live-view/nice-dcv-web-client-sdk"
);
export default defineConfig({
    plugins: [
        react(),
        viteStaticCopy({
            targets: [
                { src: path.resolve(dcvSdkDir, "dcvjs-esm"), dest: "nice-dcv-web-client-sdk" },
                { src: path.resolve(dcvSdkDir, "dcv-ui"), dest: "nice-dcv-web-client-sdk" },
            ],
        }),
    ],
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
