import { Buffer } from "buffer";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

// `@smithy/signature-v4` (used to presign AgentCore WebSocket URLs in
// lib/websocket-client/sigv4.ts) references the Node `Buffer` global.
// Vite does not polyfill Node globals by default, so in the browser the
// presign call throws `Buffer is not defined` and the avatar connection
// fails before the handshake. Expose the userland `buffer` package
// (already a transitive dependency of the AWS SDK) as a window global
// so the Smithy SigV4 signer can find it.
if (typeof window !== "undefined" && typeof window.Buffer === "undefined") {
    (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

/**
 * One-time localStorage migration: remove resizable-panel layouts persisted
 * under the pre-v2 keys. Before v2 a layout-breaking bug could persist a
 * collapsed 5 %-sized sidebar, freezing the UI into a stuck sliver on every
 * reload. Bumping the autoSaveId on both `/chat` and `/menu` plus purging the
 * stale keys here guarantees every returning user lands on the corrected
 * defaults without needing to clear their browser manually.
 *
 * Idempotent: safe to run on every mount, no-ops after the first sweep.
 *
 * Build tag: panel-fix-v2.1 (forces CDK asset-hash change so CodeBuild
 * re-runs even if the rest of the app source didn't change).
 */
function migrateResizablePanelLayouts(): void {
    try {
        const legacyKeys = [
            "resizable-layout-chat",
            "resizable-layout-menu",
            // v2 clamped minSize/maxSize too tightly on narrow viewports.
            // v3 drops maxSize and lowers the floor so the divider can slide
            // across the full viewport width.
            "resizable-layout-chat-v2",
            "resizable-layout-menu-v2",
        ];
        for (const key of legacyKeys) {
            if (window.localStorage.getItem(key) !== null) {
                window.localStorage.removeItem(key);
            }
        }
    } catch {
        // Private-browsing / storage-disabled environments — silently skip.
    }
}

migrateResizablePanelLayouts();

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
