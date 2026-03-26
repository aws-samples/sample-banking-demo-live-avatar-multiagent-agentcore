import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
    plugins: [react()],

    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
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
                },
            },
        },
    },

    server: {
        port: 3000,
        open: true,
    },
});
