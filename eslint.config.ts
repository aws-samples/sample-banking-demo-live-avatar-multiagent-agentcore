import js from "@eslint/js";
import prettier from "eslint-plugin-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";

export default tseslint.config(
    { ignores: ["**/dist", "**/cdk.out"] },
    // TypeScript files configuration
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
        },
        linterOptions: {
            reportUnusedDisableDirectives: false,
        },
        plugins: {
            prettier: prettier,
        },
        rules: {
            "no-empty": ["error", { allowEmptyCatch: true }],
            "prettier/prettier": "warn",
            "@typescript-eslint/no-unused-vars": "warn",
        },
    },
    // JavaScript files with JSX configuration
    {
        files: ["**/*.{js,jsx}"],
        languageOptions: {
            ecmaVersion: 2020,
            globals: {
                ...globals.browser,
                ...globals.node,
            },
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
                sourceType: "module",
            },
        },
        linterOptions: {
            reportUnusedDisableDirectives: false,
        },
        plugins: {
            prettier: prettier,
            react: reactPlugin,
        },
        rules: {
            "no-empty": ["error", { allowEmptyCatch: true }],
            "prettier/prettier": "warn",
            "react/jsx-uses-react": "error",
            "react/jsx-uses-vars": "error",
        },
    }
);
