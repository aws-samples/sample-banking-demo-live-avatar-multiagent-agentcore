// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Feature: prompt-optimization-showcase, Property 9: The flow-panel step folds
 * to the correct lifecycle state — for any prompt-optimization lifecycle
 * sequence, `step_start` drives the node to `active`, applying a
 * Selected_Variant drives it to `completed`, an all-targets-failed terminal
 * drives it to `failed`, and the node MAY remain `active` until a terminal
 * event arrives.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4
 *
 * The snapshot suite pins the rendered "Prompt Optimization" node (category
 * `prompt_opt`) in its active and completed states — the exact
 * `ConciergeNodeData` the flow diagram builds for the showcase step.
 * `@xyflow/react` and `framer-motion` are mocked so the pure node markup
 * renders without a DOM/animation runtime; the component under test is the same
 * `ConciergeNode` the diagram renders.
 */

import fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
    foldPromptOptStatus,
    useConciergeFlowStore,
    type PromptOptLifecycleEvent,
    type PromptOptStatus,
} from "../../lib/stacks/frontend/app/src/stores/conciergeFlowStore";
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

const LIFECYCLE_EVENTS: PromptOptLifecycleEvent[] = [
    "step_start",
    "variant_applied",
    "all_targets_failed",
];

/**
 * The expected folded status, computed independently of the implementation: the
 * last terminal input wins; absent any terminal, a `step_start` yields `active`;
 * an empty/terminal-free-and-start-free sequence stays `idle`.
 */
function expectedStatus(events: readonly PromptOptLifecycleEvent[]): PromptOptStatus {
    let lastTerminal: PromptOptLifecycleEvent | null = null;
    let sawStart = false;
    for (const event of events) {
        if (event === "variant_applied" || event === "all_targets_failed") lastTerminal = event;
        else if (event === "step_start") sawStart = true;
    }
    if (lastTerminal === "variant_applied") return "completed";
    if (lastTerminal === "all_targets_failed") return "failed";
    return sawStart ? "active" : "idle";
}

describe("Property 9 — the flow-panel step folds to the correct lifecycle state", () => {
    it("step_start ⇒ active, variant_applied ⇒ completed, all_targets_failed ⇒ failed", () => {
        fc.assert(
            fc.property(
                fc.array(fc.constantFrom(...LIFECYCLE_EVENTS), { maxLength: 12 }),
                (events) => {
                    expect(foldPromptOptStatus(events)).toBe(expectedStatus(events));
                }
            ),
            { numRuns: 200 }
        );
    });

    it("a lone step_start (with any non-terminal repeats) MAY remain active", () => {
        fc.assert(
            fc.property(
                fc.array(fc.constant<PromptOptLifecycleEvent>("step_start"), {
                    minLength: 1,
                    maxLength: 8,
                }),
                (events) => {
                    // No terminal event has arrived, so the node holds `active`.
                    expect(foldPromptOptStatus(events)).toBe("active");
                }
            ),
            { numRuns: 100 }
        );
    });

    it("the last terminal input wins over an earlier terminal", () => {
        expect(foldPromptOptStatus(["step_start", "variant_applied", "all_targets_failed"])).toBe(
            "failed"
        );
        expect(foldPromptOptStatus(["step_start", "all_targets_failed", "variant_applied"])).toBe(
            "completed"
        );
    });

    it("an empty sequence stays idle", () => {
        expect(foldPromptOptStatus([])).toBe("idle");
    });
});

describe("Property 9 — the lifecycle drives the flow store", () => {
    const store = () => useConciergeFlowStore.getState();

    it("start ⇒ active, complete ⇒ completed, fail ⇒ failed, and reset clears to idle", () => {
        fc.assert(
            fc.property(
                fc.constantFrom<"complete" | "fail" | "none">("complete", "fail", "none"),
                (terminal) => {
                    store().reset();
                    expect(store().promptOpt).toEqual({ status: "idle" });

                    // A start alone leaves the node active until a terminal event.
                    store().promptOptStart();
                    expect(store().promptOpt.status).toBe("active");

                    if (terminal === "complete") {
                        store().promptOptComplete();
                        expect(store().promptOpt.status).toBe("completed");
                    } else if (terminal === "fail") {
                        store().promptOptFail();
                        expect(store().promptOpt.status).toBe("failed");
                    } else {
                        // Lone start stays active.
                        expect(store().promptOpt.status).toBe("active");
                    }

                    store().reset();
                    expect(store().promptOpt).toEqual({ status: "idle" });
                }
            ),
            { numRuns: 100 }
        );
    });
});

describe("ConciergeFlowDiagram Prompt Optimization node — snapshot", () => {
    // The exact ConciergeNodeData the flow diagram builds for the prompt
    // optimization showcase step (see ConciergeFlowDiagram.tsx), parameterized
    // over the lifecycle status.
    const promptOptNodeData = (activity: ConciergeNodeData["activity"]): ConciergeNodeData => ({
        id: "prompt_optimization",
        label: "Prompt Optimization",
        sublabel: "Bedrock · OptimizePrompt",
        icon: "/icons/agentcore/ai-agent.png",
        category: "prompt_opt",
        activity,
    });

    const render = (data: ConciergeNodeData): string =>
        renderToStaticMarkup(
            createElement(ConciergeNode, { data } as Parameters<typeof ConciergeNode>[0])
        );

    it("renders the active Prompt Optimization node", () => {
        expect(render(promptOptNodeData("active"))).toMatchSnapshot();
    });

    it("renders the completed Prompt Optimization node", () => {
        expect(render(promptOptNodeData("completed"))).toMatchSnapshot();
    });
});
