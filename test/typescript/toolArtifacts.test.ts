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
const CANVAS = "nova-canvas-generate___nova_canvas_generate";
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
