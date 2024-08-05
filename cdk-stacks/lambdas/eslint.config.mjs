import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import typescriptEslintPlugin from "@typescript-eslint/eslint-plugin";
import typescriptEslintParser from "@typescript-eslint/parser";
import eslintPluginPrettier from "eslint-plugin-prettier";
import eslintConfigPrettier from "eslint-config-prettier";

const __filename = fileURLToPath(
    import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default [
    ...compat.extends("eslint:recommended"),
    {
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: {
            parser: typescriptEslintParser,
            parserOptions: {
                sourceType: "module",
                ecmaVersion: 2023, // Ensure ECMA version is set to 2023
            },
            globals: {
                ...globals.node,
            },
        },
        plugins: {
            "@typescript-eslint": typescriptEslintPlugin,
            "prettier": eslintPluginPrettier,
        },
        rules: {
            ...typescriptEslintPlugin.configs.recommended.rules,
            ...eslintConfigPrettier.rules,
            "indent": ["error", 2], // Enforce 2-space indentation
            "@typescript-eslint/indent": ["error", 2], // Enforce 2-space indentation for TypeScript
            "@typescript-eslint/no-explicit-any": "off",
        },
    },
];