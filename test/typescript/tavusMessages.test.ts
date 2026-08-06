// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The Tavus/Pipecat worker forwards transcripts and tool activity over the Daily
 * data channel. These map onto the same TranscriptUpdate / ToolActivity shapes
 * the LiveKit path produces, so the transcript panel and tool cards are reused.
 * These cases pin that mapping and the parsing of the wire payloads.
 */

import {
    mapWorkerMessage,
    parseWorkerMessage,
    type WorkerMessage,
} from "../../lib/stacks/frontend/app/src/lib/tavus-pipecat-client/tavusMessages";

describe("parseWorkerMessage", () => {
    it("parses a transcript object", () => {
        expect(
            parseWorkerMessage({ type: "transcript", role: "user", text: "hi", final: true })
        ).toEqual({
            type: "transcript",
            role: "user",
            text: "hi",
            final: true,
        });
    });

    it("parses a transcript delivered as a JSON string", () => {
        const msg = parseWorkerMessage(
            '{"type":"transcript","role":"agent","text":"hello","final":false}'
        );
        expect(msg).toMatchObject({
            type: "transcript",
            role: "agent",
            text: "hello",
            final: false,
        });
    });

    it("parses a tool message", () => {
        expect(
            parseWorkerMessage({
                type: "tool",
                callId: "c1",
                name: "kb_search",
                status: "running",
                input: "{}",
            })
        ).toEqual({
            type: "tool",
            callId: "c1",
            name: "kb_search",
            status: "running",
            input: "{}",
            output: undefined,
        });
    });

    it("defaults a missing callId to an empty string", () => {
        const msg = parseWorkerMessage({ type: "tool", name: "kb_search", status: "done" });
        expect(msg).toMatchObject({ callId: "", name: "kb_search", status: "done" });
    });

    it("rejects unknown / malformed payloads", () => {
        expect(parseWorkerMessage(null)).toBeNull();
        expect(parseWorkerMessage("not json")).toBeNull();
        expect(parseWorkerMessage({ type: "other" })).toBeNull();
        expect(parseWorkerMessage({ type: "transcript", role: "bogus", text: "x" })).toBeNull();
        expect(parseWorkerMessage({ type: "tool", name: "x", status: "bogus" })).toBeNull();
        expect(parseWorkerMessage({ type: "tool", status: "done" })).toBeNull();
    });
});

describe("mapWorkerMessage", () => {
    it("maps an agent transcript to an assistant TranscriptUpdate and speaking=true while streaming", () => {
        const msg: WorkerMessage = {
            type: "transcript",
            role: "agent",
            text: "one moment",
            final: false,
        };
        const mapped = mapWorkerMessage(msg);
        expect(mapped).toEqual({
            kind: "transcript",
            update: {
                segmentId: "tavus-agent",
                role: "assistant",
                text: "one moment",
                isFinal: false,
            },
            agentSpeaking: true,
        });
    });

    it("marks the agent as no longer speaking on the final transcript", () => {
        const mapped = mapWorkerMessage({
            type: "transcript",
            role: "agent",
            text: "done",
            final: true,
        });
        expect(mapped).toMatchObject({ kind: "transcript", agentSpeaking: false });
    });

    it("maps a user transcript to a user role with no speaking signal", () => {
        const mapped = mapWorkerMessage({
            type: "transcript",
            role: "user",
            text: "hi",
            final: true,
        });
        expect(mapped).toEqual({
            kind: "transcript",
            update: { segmentId: "tavus-user", role: "user", text: "hi", isFinal: true },
            agentSpeaking: null,
        });
    });

    it("maps a tool message to a ToolActivity verbatim", () => {
        const mapped = mapWorkerMessage({
            type: "tool",
            callId: "c9",
            name: "website_generator",
            status: "done",
            output: '{"url":"https://x"}',
        });
        expect(mapped).toEqual({
            kind: "tool",
            activity: {
                callId: "c9",
                name: "website_generator",
                status: "done",
                input: undefined,
                output: '{"url":"https://x"}',
            },
        });
    });
});
