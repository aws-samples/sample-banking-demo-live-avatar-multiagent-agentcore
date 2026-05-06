import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Smoke tests for the ResizablePanelLayout bugfix PR.
 *
 * `/menu` and `/chat` sit behind Cognito — a full drag-and-resize assertion
 * against a live session would require credential-mocking that is out of
 * scope for this fix. Instead we validate three invariants that together
 * guard against regression:
 *
 *   1. main.tsx compiles the localStorage migration into the production
 *      bundle (so returning users with broken layouts get fresh defaults).
 *   2. The built ResizablePanelLayout CSS ships the new visible-at-rest
 *      handle, the widened hit-target, and the data-panel overflow guard.
 *   3. The root URL served by `vite preview` reaches the React entrypoint
 *      without a 5xx / build failure.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_ASSETS = join(HERE, "..", "..", "dist", "assets");

function readDistAsset(match: RegExp): string {
    const file = readdirSync(DIST_ASSETS).find((f) => match.test(f));
    if (!file) throw new Error(`no dist asset matched ${match}`);
    return readFileSync(join(DIST_ASSETS, file), "utf8");
}

test("built ResizablePanelLayout CSS ships the new handle affordance", () => {
    const css = readDistAsset(/^ResizablePanelLayout-.*\.css$/);

    // Visible 6 px strip at rest (previously 4 px).
    expect(css).toMatch(/\.resizable-handle--horizontal\s*\{[^}]*width:\s*6px/);
    // ::before pseudo-element extends hit target by 5 px on either side.
    // CSS minifier collapses `::before` to `:before` and `left/right: -5px` to
    // shorthand `inset: 0 -5px` — accept either.
    expect(css).toMatch(/\.resizable-handle--horizontal:{1,2}before/);
    expect(css).toMatch(/(?:inset:\s*0\s+-5px|left:\s*-5px)/);
    // Grip dots visible idle (opacity raised from 0 to 0.35).
    expect(css).toMatch(
        /\.resizable-handle--horizontal:{1,2}after[^}]*opacity:\s*\.?0?\.35/s
    );
    // AWS orange hover / active / focus accent (minifier may shorten #FF9900 → #f90).
    expect(css).toMatch(/#(?:FF9900|f90)/i);
    // Panel clip + min-width guards so child content doesn't force overflow.
    expect(css).toMatch(/\[data-panel\][^{]*\{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\[data-panel\][^{]*\{[^}]*min-width:\s*0/s);
});

test("localStorage migration is compiled into the main bundle", () => {
    const mainJs = readDistAsset(/^index-.*\.js$/);
    expect(mainJs).toContain("resizable-layout-chat");
    expect(mainJs).toContain("resizable-layout-menu");
});

test("preview server returns React shell at root", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
    const html = await res.text();
    // Vite always injects a #root div and the entrypoint module.
    expect(html).toContain("id=\"root\"");
    expect(html).toMatch(/src="[^"]*\/assets\/index-[^"]+\.js"/);
});
