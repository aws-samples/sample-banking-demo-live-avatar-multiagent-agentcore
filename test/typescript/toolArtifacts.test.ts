// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * A generated website or document has to arrive as a clickable link.
 *
 * Nova Sonic speaks the outcome without emitting the URL, so the transcript card
 * is the only way a user gets one. The worker used to publish `str(output)` of an
 * MCP result — a Python repr with single quotes, which is not JSON — so
 * `JSON.parse` threw, no artifact was produced, and the panel showed a
 * "website_generator Done" badge while the avatar said it had shared a link.
 *
 * These cases pin the envelope shapes the worker can now send.
 */

import { extractToolArtifacts } from "../../lib/stacks/frontend/app/src/components/avatar/toolArtifacts";

const WEBSITE = "website-generator___website_generator";
const CANVAS = "image-generate___image_generate";
const URL = "https://example.s3.amazonaws.com/sites/hys/index.html?X-Amz-Signature=abc";

describe("extractToolArtifacts", () => {
    it("reads a bare JSON payload", () => {
        const artifacts = extractToolArtifacts(
            WEBSITE,
            JSON.stringify({ success: true, url: URL, title: "High-Yield Savings" })
        );

        expect(artifacts).toEqual([
            { kind: "website", url: URL, title: "High-Yield Savings", s3_key: undefined },
        ]);
    });

    it("unwraps the MCP content envelope", () => {
        const artifacts = extractToolArtifacts(
            WEBSITE,
            JSON.stringify({ content: [{ text: JSON.stringify({ success: true, url: URL }) }] })
        );

        expect(artifacts[0]).toMatchObject({ kind: "website", url: URL });
    });

    it("unwraps a bare content-block list", () => {
        // What an MCP tool result serialises to once the worker uses json.dumps
        // instead of str(): a list, with no wrapping object.
        const artifacts = extractToolArtifacts(
            WEBSITE,
            JSON.stringify([{ type: "text", text: JSON.stringify({ success: true, url: URL }) }])
        );

        expect(artifacts[0]).toMatchObject({ kind: "website", url: URL });
    });

    it("unwraps a doubly nested envelope", () => {
        const inner = JSON.stringify({ success: true, url: URL });
        const artifacts = extractToolArtifacts(
            WEBSITE,
            JSON.stringify([{ text: JSON.stringify({ content: [{ text: inner }] }) }])
        );

        expect(artifacts[0]).toMatchObject({ kind: "website", url: URL });
    });

    it("accepts website_url, which the pipeline path returns instead of url", () => {
        const artifacts = extractToolArtifacts(
            WEBSITE,
            JSON.stringify({ status: "success", website_url: URL })
        );

        expect(artifacts[0]).toMatchObject({ kind: "website", url: URL });
    });

    it("produces nothing from a Python repr, the shape that used to be sent", () => {
        // Documents why the worker must not use str(): single quotes are not JSON,
        // so there is no way to recover a link on the client.
        const artifacts = extractToolArtifacts(
            WEBSITE,
            "[{'type': 'text', 'text': '{\"success\": true, \"url\": \"" + URL + "\"}'}]"
        );

        expect(artifacts).toEqual([]);
    });

    it("treats url as a link only for tools that produce one", () => {
        // Other tools use `url` for source documents and citations.
        expect(
            extractToolArtifacts("web-search___web_search", JSON.stringify({ url: URL }))
        ).toEqual([]);
    });

    it("extracts generated images", () => {
        const artifacts = extractToolArtifacts(
            CANVAS,
            JSON.stringify({ content: [{ text: JSON.stringify({ image_url: URL }) }] })
        );

        expect(artifacts[0]).toMatchObject({ kind: "media", mediaType: "image", url: URL });
    });

    it("hands knowledge-base results over untouched", () => {
        const raw = JSON.stringify({ results: [{ title: "x" }] });

        expect(extractToolArtifacts("kb-search___kb_search", raw)).toEqual([
            { kind: "kb", resultJson: raw },
        ]);
    });

    it("returns nothing for an empty or unparseable result", () => {
        expect(extractToolArtifacts(WEBSITE, "")).toEqual([]);
        expect(extractToolArtifacts(WEBSITE, "not json at all")).toEqual([]);
    });
});

describe("asset link catch-all", () => {
    it("offers a link when an asset tool uses an unexpected field name", () => {
        // The reason this exists: website_generator's field differed from the one
        // checked, so the agent announced a site the user could not open.
        const artifacts = extractToolArtifacts(
            "pdf-generator___pdf_generator",
            JSON.stringify({ success: true, download_url: URL })
        );

        expect(artifacts).toEqual([
            { kind: "link", url: URL, label: "Open", toolName: "pdf-generator___pdf_generator" },
        ]);
    });

    it("prefers the specific card and does not also add a catch-all link", () => {
        const artifacts = extractToolArtifacts(
            WEBSITE,
            JSON.stringify({ success: true, url: URL })
        );

        expect(artifacts).toHaveLength(1);
        expect(artifacts[0].kind).toBe("website");
    });

    it("uses the title as the button label when one is given", () => {
        const artifacts = extractToolArtifacts(
            "extract-pdf-images___extract_pdf_images",
            JSON.stringify({ presigned_url: URL, title: "Branch lobby" })
        );

        expect(artifacts[0]).toMatchObject({ kind: "link", label: "Branch lobby" });
    });

    it("unwraps a list-valued url field", () => {
        const artifacts = extractToolArtifacts(
            "extract-pdf-images___extract_pdf_images",
            JSON.stringify({ presigned_url: [URL, "https://example.invalid/second"] })
        );

        expect(artifacts[0]).toMatchObject({ kind: "link", url: URL });
    });

    it("never offers citation URLs from search tools as assets", () => {
        // web_search and kb_search results are full of URLs that the agent did
        // not produce; presenting them as generated assets would be wrong.
        for (const tool of ["web-search___web_search", "kb-search___kb_search"]) {
            const artifacts = extractToolArtifacts(
                tool,
                JSON.stringify({ citations: [{ url: URL }], url: URL })
            );

            expect(artifacts.every((a) => a.kind !== "link")).toBe(true);
        }
    });

    it("ignores a non-http value in a url field", () => {
        const artifacts = extractToolArtifacts(
            WEBSITE,
            JSON.stringify({ s3_url: "s3://bucket/key.html" })
        );

        expect(artifacts).toEqual([]);
    });
});
