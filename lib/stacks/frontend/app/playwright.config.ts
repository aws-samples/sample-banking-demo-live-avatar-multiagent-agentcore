import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for frontend e2e / visual-regression tests.
 *
 * Boots `vite preview` against the already-built `dist/` bundle so tests
 * exercise production CSS/JS, not the dev-server's HMR wrapper. `/menu` and
 * `/chat` are Cognito-gated; the current suite only smokes the assets served
 * by the root route plus the built CSS file for the ResizablePanelLayout —
 * enough to catch regressions in handle styling without requiring a signed-in
 * session.
 */
export default defineConfig({
    testDir: "./tests/e2e",
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: "list",
    timeout: 30_000,
    use: {
        baseURL: "http://localhost:3000",
        trace: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
    webServer: {
        command: "npm run preview",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
});
