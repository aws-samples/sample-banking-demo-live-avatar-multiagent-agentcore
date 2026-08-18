// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Grounded-source extraction turns transient tool-result JSON into the stable
 * provenance list the flow panel shows. It runs on live, sometimes-malformed
 * tool output, so it must never throw — bad input yields [].
 */

import { extractGroundedSources } from "../../lib/stacks/frontend/app/src/components/common/flow/grounding";

const KB = "kb-search___kb_search";
const WEB = "web-search___web_search";

describe("extractGroundedSources", () => {
    it("returns [] for non-grounding tools", () => {
        expect(extractGroundedSources("pdf-generator___pdf_generator", "{}")).toEqual([]);
    });

    it("returns [] for empty or unparseable results", () => {
        expect(extractGroundedSources(KB, "")).toEqual([]);
        expect(extractGroundedSources(KB, "not json")).toEqual([]);
    });

    it("extracts KB documents with pages", () => {
        const raw = JSON.stringify({
            documents: [
                {
                    filename: "Report-8c5.pdf",
                    url: "https://s3/report.pdf",
                    pages_referenced: [2, 12],
                },
            ],
        });
        expect(extractGroundedSources(KB, raw)).toEqual([
            { kind: "kb", title: "Report-8c5.pdf", detail: "p.2, 12", url: "https://s3/report.pdf" },
        ]);
    });

    it("falls back to KB citations when no documents rollup exists", () => {
        const raw = JSON.stringify({
            citations: [{ source: "Strategy.pdf", page: 3, score: 0.71, url: "https://s3/s.pdf" }],
        });
        expect(extractGroundedSources(KB, raw)).toEqual([
            { kind: "kb", title: "Strategy.pdf", detail: "p.3 · 0.71", url: "https://s3/s.pdf" },
        ]);
    });

    it("extracts web citations with an explicit domain", () => {
        const raw = JSON.stringify({
            citations: [{ url: "https://www.rfi.fr/article", domain: "rfi.fr" }],
        });
        expect(extractGroundedSources(WEB, raw)).toEqual([
            { kind: "web", title: "rfi.fr", detail: undefined, url: "https://www.rfi.fr/article" },
        ]);
    });

    it("derives the web domain from the url when none is given", () => {
        const raw = JSON.stringify({ citations: [{ url: "https://www.example.com/x/y" }] });
        expect(extractGroundedSources(WEB, raw)).toEqual([
            { kind: "web", title: "example.com", detail: undefined, url: "https://www.example.com/x/y" },
        ]);
    });

    it("accepts a `sources` array shape for web results", () => {
        const raw = JSON.stringify({ sources: [{ domain: "aws.amazon.com" }] });
        expect(extractGroundedSources(WEB, raw)).toEqual([
            { kind: "web", title: "aws.amazon.com", detail: undefined, url: undefined },
        ]);
    });

    it("omits KB documents with no filename", () => {
        const raw = JSON.stringify({ documents: [{ url: "https://s3/x.pdf" }] });
        expect(extractGroundedSources(KB, raw)).toEqual([]);
    });
});
