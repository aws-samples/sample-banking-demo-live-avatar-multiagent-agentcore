import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
    js.configs.recommended,
    {
        files: ["src/**/*.{ts,tsx}"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
                ecmaFeatures: { jsx: true },
            },
            globals: {
                window: "readonly",
                document: "readonly",
                console: "readonly",
                fetch: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                URL: "readonly",
                URLSearchParams: "readonly",
                AbortController: "readonly",
                Response: "readonly",
                Request: "readonly",
                Headers: "readonly",
                EventSource: "readonly",
                WebSocket: "readonly",
                HTMLElement: "readonly",
                HTMLInputElement: "readonly",
                HTMLTextAreaElement: "readonly",
                HTMLButtonElement: "readonly",
                HTMLDivElement: "readonly",
                Event: "readonly",
                MouseEvent: "readonly",
                KeyboardEvent: "readonly",
                FormData: "readonly",
                Blob: "readonly",
                File: "readonly",
                FileReader: "readonly",
                localStorage: "readonly",
                sessionStorage: "readonly",
                navigator: "readonly",
                location: "readonly",
                history: "readonly",
                crypto: "readonly",
                TextEncoder: "readonly",
                TextDecoder: "readonly",
                ReadableStream: "readonly",
                MediaStream: "readonly",
                AudioContext: "readonly",
                structuredClone: "readonly",
                requestAnimationFrame: "readonly",
                cancelAnimationFrame: "readonly",
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
            "react-hooks": reactHooks,
        },
        rules: {
            ...tseslint.configs.recommended.rules,
            ...reactHooks.configs.recommended.rules,
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            "@typescript-eslint/no-explicit-any": "warn",
            "no-undef": "off", // TypeScript handles this
        },
    },
    {
        ignores: ["build/", "node_modules/", "*.config.js", "*.config.ts", "*.config.d.ts"],
    },
];
