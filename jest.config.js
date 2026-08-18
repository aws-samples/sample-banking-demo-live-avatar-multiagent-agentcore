module.exports = {
    testEnvironment: "node",
    roots: ["<rootDir>/test"],
    testMatch: ["**/*.test.ts", "**/*.test.tsx"],
    transform: {
        "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.jest.json" }],
    },
    // The frontend app resolves "@/..." to its src root via a Vite/tsconfig
    // path alias. Mirror that here so tests can import frontend modules (e.g.
    // the concierge flow store) that use the alias internally.
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/lib/stacks/frontend/app/src/$1",
    },
};
