import prettier from "eslint-plugin-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
    {
        ignores: [
            "**/dist",
            "**/cdk.out",
            "**/node_modules",
            "**/.venv/**",
            "**/*.d.ts",
            "**/*.min.js",
            "**/*.min.mjs",
            // Local experiment sandbox (gitignored) — not part of the project.
            ".sandbox/**",
            "lib/stacks/frontend/app/**",
        ],
    },
    ...tseslint.configs.recommended,
    {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: __dirname,
            },
        },
        linterOptions: {
            reportUnusedDisableDirectives: false,
        },
        plugins: {
            prettier,
        },
        rules: {
            "prettier/prettier": "warn",
        },
    },
];
