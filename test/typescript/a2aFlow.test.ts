// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Feature: a2a-agent-collaboration, Property 16: For any `a2a_call` SSE payload,
 * the parser emits a well-formed `a2a_call` event with `agent`, `phase`, and
 * `status`; feeding a `start → end` sequence drives the flow store to a
 * `completed` state, an `error` status drives it to a `failed` state, and an
 * event with `identity_forwarded` true sets the store's identity-carried
 * indicator (the store MAY remain in the in-progress state until the terminal
 * event arrives).
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4
 *
 * The snapshot suite pins the rendered "Fraud Research Agent" A2A node
 * (category `a2a`) across its idle/active/completed/failed states, with the
 * customer identity-carried indicator on and off. `@xyflow/react` and
 * `framer-motion` are mocked so the pure node markup renders in the node test
 * environment without a DOM/animation runtime; the component under test is the
 * same `ConciergeNode` the flow diagram renders for the A2A hop.
 */

import fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { parseStrandsChunk } from "../../lib/stacks/frontend/app/src/lib/agentcore-client/parsers/strands";
import type { StreamEvent } from "../../lib/stacks/frontend/app/src/lib/agentcore-client/types";
import { useConciergeFlowStore } from "../../lib/stacks/frontend/app/src/stores/conciergeFlowStore";
import { ConciergeNode } from "../../lib/stacks/frontend/app/src/components/concierge-flow/ConciergeNode";
import type { ConciergeNodeData } from "../../lib/stacks/frontend/app/src/components/concierge-flow/flow-types";

// The flow node is pure presentation. Replace React Flow's Handle (which reaches
// for provider context) and framer-motion's animated elements with plain markup
// so the node renders deterministically outside a browser.
jest.mock("@xyflow/react", () => ({
    Handle: () => null,
    Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

jest.mock("framer-motion", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const react = require("react");
    const stripMotionProps = (props: Record<string, unknown> = {}) => {
        const {
            initial,
            animate,
            transition,
            exit,
            whileHover,
            whileTap,
            whileInView,
            drag,
            layout,
            layoutId,
            variants,
            ...rest
        } = props;
        void initial;
        void animate;
        void transition;
        void exit;
        void whileHover;
        void whileTap;
        void whileInView;
        void drag;
        void layout;
        void layoutId;
        void variants;
        return rest;
    };
    const motion = new Proxy(
        {},
        {
            get:
                (_target, tag: string) =>
                (props: Record<string, unknown> = {}) =>
                    react.createElement(tag, stripMotionProps(props)),
        }
    );
    return { motion };
});

const SSE = (payload: unknown): string => `data: ${JSON.stringify(payload)}`;

/** Parse a single SSE line, returning the sole emitted event (or the count). */
function parseEvents(line: string): StreamEvent[] {
    const events: StreamEvent[] = [];
    parseStrandsChunk(line, (e) => events.push(e));
    return events;
}

describe("Property 16 — a2a_call parser emits a well-formed event", () => {
    it("normalizes status, phase, agent, and identityForwarded for any payload", () => {
        // Agents the backend may attribute the hop to, plus arbitrary strings the
        // parser passes through untyped (it casts `agent as AgentId`).
        const agentArb = fc.oneof(
            fc.constant("fraud_research"),
            fc.constant("researcher"),
            fc.string({ minLength: 1, maxLength: 12 })
        );
        // start | end | error are recognized; anything else must normalize to "start".
        const statusArb = fc.oneof(
            fc.constantFrom("start", "end", "error"),
            fc.string({ maxLength: 8 })
        );
        // identityForwarded is strict `=== true`, so exercise non-boolean truthy
        // values that must NOT set the flag.
        const identityArb = fc.oneof(
            fc.boolean(),
            fc.constant("true"),
            fc.constant(1),
            fc.constant(undefined)
        );

        fc.assert(
            fc.property(agentArb, statusArb, identityArb, (agent, status, identityForwarded) => {
                const events = parseEvents(
                    SSE({
                        a2a_call: {
                            agent,
                            phase: "collaboration",
                            status,
                            identity_forwarded: identityForwarded,
                        },
                    })
                );

                expect(events).toHaveLength(1);
                const event = events[0];
                expect(event.type).toBe("a2a_call");
                if (event.type !== "a2a_call") return; // narrow for TS

                expect(event.phase).toBe("collaboration");
                expect(event.agent).toBe(agent);

                const expectedStatus = status === "end" || status === "error" ? status : "start";
                expect(event.status).toBe(expectedStatus);

                // Only a literal boolean true forwards identity.
                expect(event.identityForwarded).toBe(identityForwarded === true);
            }),
            { numRuns: 200 }
        );
    });
});

describe("Property 16 — parsed a2a_call events drive the flow store", () => {
    const store = () => useConciergeFlowStore.getState();

    // Feed a parsed a2a_call event into the store the same way the chat engine
    // does: start → a2aStart, end → a2aEnd, error → a2aError.
    function applyToStore(event: StreamEvent): void {
        if (event.type !== "a2a_call") return;
        if (event.status === "start") store().a2aStart(event.identityForwarded);
        else if (event.status === "end") store().a2aEnd();
        else if (event.status === "error") store().a2aError();
    }

    it("start→end ⇒ completed, error ⇒ failed, and identity forwarding is reflected and retained", () => {
        const terminalArb = fc.constantFrom<"end" | "error" | "none">("end", "error", "none");

        fc.assert(
            fc.property(fc.boolean(), terminalArb, (identityForwarded, terminal) => {
                store().reset();
                expect(store().a2a).toEqual({ status: "idle", identityForwarded: false });

                // A start event alone leaves the node in-progress (Req 9.3).
                const [startEvent] = parseEvents(
                    SSE({
                        a2a_call: {
                            agent: "fraud_research",
                            phase: "collaboration",
                            status: "start",
                            identity_forwarded: identityForwarded,
                        },
                    })
                );
                applyToStore(startEvent);

                expect(store().a2a.status).toBe("active");
                expect(store().a2a.identityForwarded).toBe(identityForwarded);

                if (terminal === "none") return; // lone start stays active

                const [terminalEvent] = parseEvents(
                    SSE({
                        a2a_call: {
                            agent: "fraud_research",
                            phase: "collaboration",
                            status: terminal,
                            identity_forwarded: identityForwarded,
                        },
                    })
                );
                applyToStore(terminalEvent);

                expect(store().a2a.status).toBe(terminal === "end" ? "completed" : "failed");
                // The identity-carried indicator survives the terminal event (Req 9.2).
                expect(store().a2a.identityForwarded).toBe(identityForwarded);
            }),
            { numRuns: 200 }
        );
    });

    it("reset clears the A2A step back to idle", () => {
        store().a2aStart(true);
        store().a2aEnd();
        store().reset();
        expect(store().a2a).toEqual({ status: "idle", identityForwarded: false });
    });
});

describe("ConciergeFlowDiagram A2A node — snapshot", () => {
    // The exact ConciergeNodeData the flow diagram builds for the fraud-research
    // hop (see ConciergeFlowDiagram.tsx), parameterized over the lifecycle.
    const a2aNodeData = (
        activity: ConciergeNodeData["activity"],
        identityCarried: boolean
    ): ConciergeNodeData => ({
        id: "fraud_research",
        label: "Fraud Research Agent",
        sublabel: "A2A · another team's agent",
        icon: "/icons/agentcore/runtime.png",
        category: "a2a",
        activity,
        identityCarried,
    });

    const render = (data: ConciergeNodeData): string =>
        renderToStaticMarkup(
            createElement(ConciergeNode, { data } as Parameters<typeof ConciergeNode>[0])
        );

    it("renders the idle A2A node without the identity indicator", () => {
        expect(render(a2aNodeData("idle", false))).toMatchSnapshot();
    });

    it("renders the active A2A node with the identity-carried indicator", () => {
        expect(render(a2aNodeData("active", true))).toMatchSnapshot();
    });

    it("renders the completed A2A node with the identity-carried indicator", () => {
        expect(render(a2aNodeData("completed", true))).toMatchSnapshot();
    });

    it("renders the failed A2A node with the identity-carried indicator", () => {
        expect(render(a2aNodeData("failed", true))).toMatchSnapshot();
    });
});
