// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Snapshot of the Prompt Optimization Showcase_Card with the Baseline_Variant
 * and one succeeded Candidate_Variant present, plus a Selected_Variant applied.
 * Asserts the baseline block, the candidate (per-model) block, and the
 * applied-variant display all render.
 *
 * Cloudscape components ship as ESM (which jest does not transform under
 * node_modules), so each Cloudscape subpath the card imports is mocked with a
 * lightweight stub. The card is rendered to static markup with react-dom/server
 * in the default node test environment — no jsdom required.
 *
 * Validates: Requirements 4.1, 4.2, 8.5
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- Cloudscape stubs (hoisted above imports by jest) ----------------------
jest.mock("@cloudscape-design/components/container", () => {
    const React = require("react");
    return {
        __esModule: true,
        default: ({ header, children }: any) =>
            React.createElement("div", { "data-cs": "container" }, header, children),
    };
});
jest.mock("@cloudscape-design/components/header", () => {
    const React = require("react");
    return {
        __esModule: true,
        default: ({ children, description }: any) =>
            React.createElement("div", { "data-cs": "header" }, children, description),
    };
});
jest.mock("@cloudscape-design/components/box", () => {
    const React = require("react");
    return {
        __esModule: true,
        default: ({ children }: any) => React.createElement("div", { "data-cs": "box" }, children),
    };
});
jest.mock("@cloudscape-design/components/button", () => {
    const React = require("react");
    return {
        __esModule: true,
        default: ({ children, disabled, onClick }: any) =>
            React.createElement(
                "button",
                { "data-cs": "button", disabled: !!disabled, onClick },
                children
            ),
    };
});
jest.mock("@cloudscape-design/components/badge", () => {
    const React = require("react");
    return {
        __esModule: true,
        default: ({ children }: any) =>
            React.createElement("span", { "data-cs": "badge" }, children),
    };
});
jest.mock("@cloudscape-design/components/space-between", () => {
    const React = require("react");
    return {
        __esModule: true,
        default: ({ children }: any) =>
            React.createElement("div", { "data-cs": "space-between" }, children),
    };
});
jest.mock("@cloudscape-design/components/status-indicator", () => {
    const React = require("react");
    return {
        __esModule: true,
        default: ({ children, type }: any) =>
            React.createElement("span", { "data-cs": "status", "data-type": type }, children),
    };
});
jest.mock("@cloudscape-design/components/radio-group", () => {
    const React = require("react");
    return {
        __esModule: true,
        default: ({ items, value }: any) =>
            React.createElement(
                "div",
                { "data-cs": "radio-group", "data-value": value ?? "" },
                (items ?? []).map((it: any) =>
                    React.createElement(
                        "label",
                        { key: it.value, "data-value": it.value },
                        it.label
                    )
                )
            ),
    };
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PromptOptimizationCard } from "../../lib/stacks/frontend/app/src/components/chat/PromptOptimizationCard";
import {
    usePromptOptimizationStore,
    type PromptOptEvent,
} from "../../lib/stacks/frontend/app/src/stores/usePromptOptimizationStore";

const SONNET_ID = "anthropic.claude-sonnet-4-5-20250929-v1:0";
const SONNET_INVOKE = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
const SONNET_LABEL = "Claude Sonnet 4.5";
const BASELINE_PROMPT = "You are Ada, the Trinity Reserve AI advisor. Be concise.";
const OPTIMIZED_PROMPT = "System prompt optimized for Claude Sonnet 4.5: be concise and precise.";

function promptOptEvent(kind: PromptOptEvent["kind"], text: string): PromptOptEvent {
    return { type: "prompt_opt", targetModelId: SONNET_ID, modelLabel: SONNET_LABEL, kind, text };
}

describe("PromptOptimizationCard snapshot — baseline + one succeeded candidate, applied", () => {
    beforeEach(() => {
        const store = usePromptOptimizationStore.getState();
        store.clear();
        store.setBaselinePrompt(BASELINE_PROMPT);
        // Stream one model to `succeeded`: analysis then optimized prompt.
        store.applyEvent(promptOptEvent("analysis", "Analysis: tighten the guardrails."));
        store.applyEvent(promptOptEvent("optimized", OPTIMIZED_PROMPT));
        // Apply the candidate so the applied-variant display renders (Req 8.5).
        store.select({
            kind: "candidate",
            modelId: SONNET_ID,
            invokeId: SONNET_INVOKE,
            prompt: OPTIMIZED_PROMPT,
            label: SONNET_LABEL,
            optimizedForModelId: SONNET_ID,
        });
    });

    it("renders the baseline block, the candidate block, and the applied-variant display", () => {
        const html = renderToStaticMarkup(
            React.createElement(PromptOptimizationCard, { onAction: () => undefined })
        );

        expect(html).toMatchSnapshot();

        // Baseline block (Req 4.1) — the current configuration and its prompt.
        expect(html).toContain("Current configuration");
        expect(html).toContain(BASELINE_PROMPT);

        // Candidate / per-model block (Req 4.2) — the model and its optimized prompt.
        expect(html).toContain(SONNET_LABEL);
        expect(html).toContain(OPTIMIZED_PROMPT);

        // Applied-variant display (Req 8.5).
        expect(html).toContain("Applied to this session");
    });
});
