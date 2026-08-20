import { useEffect, useRef, useState, useCallback } from "react";
import { Message, MessageSegment, ToolCall } from "@/components/chat/types";
import { AgentCoreClient } from "@/lib/agentcore-client";
import type { AgentPattern, StreamEvent } from "@/lib/agentcore-client";
import type { AgentId, ResearchPhase } from "@/lib/agentcore-client/types";
import { useAuth } from "react-oidc-context";
import { useModelSelector } from "@/hooks/useModelSelector";
import { useChatStore } from "@/stores/chatStore";
import type { ResearchAction } from "@/stores/chatStore";
import { useConciergeFlowStore } from "@/stores/conciergeFlowStore";
import {
    usePromptOptimizationStore,
    deriveAppliedConfig,
} from "@/stores/usePromptOptimizationStore";
import { usePromptImprovementStore } from "@/stores/usePromptImprovementStore";
import type { EvaluationData } from "@/components/common/evaluation/types";
import { useBrowserLiveViewStore } from "@/stores/browserLiveViewStore";
import { normalizeToolName } from "@/components/concierge-flow/flow-types";
import { extractGroundedSources } from "@/components/common/flow/grounding";

export type { ResearchAction };

export interface UseChatEngineOptions {
    onResearchEvent?: (action: ResearchAction) => void;
    /** Agent mode sent in the payload */
    mode?: "research" | "chatbot" | "menu" | "generic_research" | "archive_chat" | "menu_export";
}

export interface UseChatEngineReturn {
    messages: Message[];
    sendMessage: (text: string) => Promise<void>;
    executeResearchPlan: (
        plan: Record<string, unknown>,
        query: string,
        modeOverride?: string,
        /** Approved spend ceiling (USD) for paid premium data, if any. */
        paymentBudgetUsd?: string
    ) => Promise<void>;
    /** Continue the catalog pipeline with the user-approved catalog. */
    exportCatalog: (catalog: Record<string, unknown>) => Promise<void>;
    /** Ask the orchestrator to propose designer-prompt refinements from feedback. */
    optimizeFromFeedback: () => Promise<void>;
    /** Re-synthesize a flagged report to fix only its sub-threshold dimensions. */
    reviseReport: (payload: {
        report_text?: string;
        weak_dimensions?: unknown[];
        gaps?: string[];
        query?: string;
    }) => Promise<void>;
    isLoading: boolean;
    error: string | null;
    clearError: () => void;
    sessionId: string;
    startNewChat: () => void;
    isReady: boolean;
}

/**
 * Each agent experience is its own AgentCore Runtime, so pick the runtime ARN
 * by mode. The AI Assistant (menu) and AI Agent (chatbot/archive) have their
 * own runtimes; everything else is a research experience. Falls back to the
 * back-compat orchestrator ARN if a specific one isn't injected.
 */
function runtimeArnForMode(mode: string): string | undefined {
    const env = import.meta.env;
    if (mode === "menu" || mode === "menu_export") {
        return env.VITE_RUNTIME_ARN_ASSISTANT || env.VITE_RUNTIME_ARN_ORCHESTRATOR;
    }
    if (mode === "chatbot" || mode === "archive_chat") {
        return env.VITE_RUNTIME_ARN_AGENT || env.VITE_RUNTIME_ARN_ORCHESTRATOR;
    }
    // research, generic_research (+ their *_execute variants) and any default.
    return env.VITE_RUNTIME_ARN_RESEARCH || env.VITE_RUNTIME_ARN_ORCHESTRATOR;
}

export function useChatEngine(options?: UseChatEngineOptions): UseChatEngineReturn {
    const [client, setClient] = useState<AgentCoreClient | null>(null);

    const mode = options?.mode ?? "research";
    const storeKey = mode;

    // Ensure slot exists on mount
    useEffect(() => {
        useChatStore.getState().getOrCreateSlot(storeKey);
    }, [storeKey]);

    // Read from Zustand store
    const messages = useChatStore((s) => s.slots[storeKey]?.messages ?? []);
    const isLoading = useChatStore((s) => s.slots[storeKey]?.isLoading ?? false);
    const error = useChatStore((s) => s.slots[storeKey]?.error ?? null);
    const sessionId = useChatStore((s) => s.slots[storeKey]?.sessionId ?? "");

    const auth = useAuth();
    const { modelId } = useModelSelector();

    // Keep a stable ref for the options callback
    const onResearchEventRef = useRef(options?.onResearchEvent);
    onResearchEventRef.current = options?.onResearchEvent;

    // Dispatch research actions to Zustand
    const researchDispatch = useCallback(
        (action: ResearchAction) => {
            useChatStore.getState().dispatchResearch(storeKey, action);
            onResearchEventRef.current?.(action);
        },
        [storeKey]
    );

    useEffect(() => {
        const runtimeArn = runtimeArnForMode(mode);
        if (!runtimeArn) {
            useChatStore
                .getState()
                .setError(storeKey, "Configuration error: Agent Runtime ARN not found");
            return;
        }
        setClient(
            new AgentCoreClient({
                runtimeArn,
                region: import.meta.env.VITE_REGION || "us-east-1",
                pattern: "strands-single-agent" as AgentPattern,
            })
        );
    }, [storeKey, mode]);

    /** Shared streaming logic — sends a request and processes SSE events into message segments. */
    const _streamResponse = useCallback(
        async (
            userMessage: string,
            requestMode: string | undefined,
            extra?: Record<string, unknown>
        ): Promise<void> => {
            if (!client) return;

            const { setMessages, setLoading, setError: storeSetError } = useChatStore.getState();
            setLoading(storeKey, true);

            const assistantResponse: Message = {
                role: "assistant",
                content: "",
                timestamp: new Date().toISOString(),
            };

            setMessages(storeKey, (prev) => [...prev, assistantResponse]);

            try {
                const accessToken = auth.user?.access_token;

                if (!accessToken) {
                    throw new Error("Authentication required. Please log in again.");
                }

                const segments: MessageSegment[] = [];
                const toolCallMap = new Map<string, ToolCall>();
                const flowStore = useConciergeFlowStore.getState();
                flowStore.reset();
                flowStore.runtimeStart();

                // Apply a presenter-selected Prompt Optimization variant to the
                // live AI Agent for this session. A Candidate_Variant rides on
                // each subsequent chatbot request via the existing model_id /
                // system_prompt_override seams; the Baseline_Variant (or no
                // selection) keeps the Current_Model + Current_System_Prompt.
                // The selection lives only in the client store for this browser
                // session, so it never crosses into another presenter's session.
                const applied =
                    requestMode === "chatbot"
                        ? deriveAppliedConfig(usePromptOptimizationStore.getState().selected)
                        : { model_id: null, system_prompt_override: null };
                const appliedExtra: Record<string, unknown> = {};
                if (applied.system_prompt_override) {
                    appliedExtra.system_prompt_override = applied.system_prompt_override;
                }
                if (applied.model_id) {
                    // A Candidate_Variant is now applied to a live request —
                    // mark the prompt-optimization flow node completed (design §8:
                    // applying a Selected_Variant → completed).
                    flowStore.promptOptComplete();
                }

                // Continuous feedback loop: when the presenter has applied a
                // feedback-derived designer refinement, a fresh catalog design
                // run carries it as `designer_prompt_addendum` so the backend
                // appends it to the designer prompt. Only for the design run
                // itself ("menu"), not the export continuation.
                if (requestMode === "menu") {
                    const addendum = usePromptImprovementStore.getState().addendum;
                    if (addendum) {
                        appliedExtra.designer_prompt_addendum = addendum;
                    }
                }

                const updateMessage = (): void => {
                    const content = segments
                        .filter(
                            (s): s is Extract<MessageSegment, { type: "text" }> => s.type === "text"
                        )
                        .map((s) => s.content)
                        .join("");

                    setMessages(storeKey, (prev) => {
                        const updated = [...prev];
                        updated[updated.length - 1] = {
                            ...updated[updated.length - 1],
                            content,
                            segments: [...segments],
                        };
                        return updated;
                    });
                };

                // Tracks the phase currently marked active in the research flow so
                // a terminal `stream_error` can close it instead of leaving the
                // node spinning. Cleared when the phase ends or errors.
                let activePhaseRef: { agent: AgentId; phase: ResearchPhase } | null = null;

                // Include research_depth for research modes
                const depth = useChatStore.getState().researchDepth;
                const depthExtra: Record<string, unknown> = {};
                if (
                    requestMode &&
                    (requestMode.includes("research") || requestMode === "research")
                ) {
                    depthExtra.research_depth = depth;
                }

                await client.invoke(
                    userMessage,
                    sessionId,
                    accessToken,
                    (event: StreamEvent) => {
                        switch (event.type) {
                            case "text": {
                                const prev = segments[segments.length - 1];
                                if (prev && prev.type === "tool") {
                                    for (const tc of toolCallMap.values()) {
                                        if (
                                            tc.status === "streaming" ||
                                            tc.status === "executing"
                                        ) {
                                            tc.status = "complete";
                                        }
                                    }
                                }
                                const last = segments[segments.length - 1];
                                if (last && last.type === "text") {
                                    last.content += event.content;
                                } else {
                                    segments.push({ type: "text", content: event.content });
                                }
                                updateMessage();
                                break;
                            }
                            case "agent_text": {
                                const lastSeg = segments[segments.length - 1];
                                if (lastSeg && lastSeg.type === "text") {
                                    lastSeg.content += event.content;
                                } else {
                                    segments.push({ type: "text", content: event.content });
                                }
                                updateMessage();
                                break;
                            }
                            case "tool_use_start": {
                                useConciergeFlowStore
                                    .getState()
                                    .toolStart(event.toolUseId, event.name);
                                // Attribute the call to whichever pipeline agent
                                // is currently running, so each node in the flow
                                // diagram can show the services *it* exercised.
                                if (activePhaseRef) {
                                    researchDispatch({
                                        type: "TOOL_CALL",
                                        agent: activePhaseRef.agent,
                                        tool: normalizeToolName(event.name),
                                    });
                                }
                                // Metrics-only calls stop here. The parallel
                                // researcher's workers report their tool use for
                                // the diagram and run report, but their
                                // arguments and results never stream, so a chat
                                // card would stay empty — dozens of blank
                                // dropdowns burying the conversation.
                                if (event.telemetryOnly) break;

                                const tc: ToolCall = {
                                    toolUseId: event.toolUseId,
                                    name: event.name,
                                    input: "",
                                    status: "streaming",
                                };
                                toolCallMap.set(event.toolUseId, tc);
                                segments.push({ type: "tool", toolCall: tc });
                                updateMessage();
                                break;
                            }
                            case "tool_use_delta": {
                                const tc = toolCallMap.get(event.toolUseId);
                                if (tc) {
                                    tc.input += event.input;
                                }
                                updateMessage();
                                break;
                            }
                            case "tool_result": {
                                const tc = toolCallMap.get(event.toolUseId);
                                if (tc) {
                                    tc.result = event.result;
                                    tc.status = "complete";
                                }
                                useConciergeFlowStore.getState().toolEnd(event.toolUseId);
                                // Capture the concrete sources a grounding tool
                                // pulled (KB docs, web domains) so the flow
                                // panel can show provenance, not just counts.
                                if (tc?.name) {
                                    const grounded = extractGroundedSources(tc.name, event.result);
                                    if (grounded.length) {
                                        useConciergeFlowStore.getState().addSources(grounded);
                                    }
                                }
                                updateMessage();
                                break;
                            }
                            case "message": {
                                if (event.role === "assistant") {
                                    for (const tc of toolCallMap.values()) {
                                        if (tc.status === "streaming") tc.status = "executing";
                                    }
                                    updateMessage();
                                }
                                break;
                            }
                            case "_ui": {
                                // BrowserLiveView pops out into a dedicated sidebar,
                                // not inline in the chat message.
                                if (event.component === "BrowserLiveView") {
                                    const p = event.props as Record<string, unknown>;
                                    useBrowserLiveViewStore.getState().open({
                                        liveViewUrl: p.liveViewUrl as string,
                                        sessionId: p.sessionId as string | undefined,
                                        remoteWidth: p.remoteWidth as number | undefined,
                                        remoteHeight: p.remoteHeight as number | undefined,
                                    });
                                    break;
                                }
                                if (event.component === "BrowserScreenshot") {
                                    const p = event.props as Record<string, unknown>;
                                    useBrowserLiveViewStore
                                        .getState()
                                        .setScreenshot(p.image as string);
                                    break;
                                }
                                // Services Catalog: populate the store (the side
                                // panel and the avatar read from it) and then
                                // FALL THROUGH so the review card also renders
                                // inline in the chat. The interactive controls
                                // live on that card, not in the side panel.
                                if (event.component === "ServicesCatalog") {
                                    const p = event.props as {
                                        sections?: {
                                            name?: string;
                                            items?: Record<string, unknown>[];
                                        }[];
                                    };
                                    const mapped = (p.sections ?? []).map((sec, si) => ({
                                        category: sec.name ?? `Section ${si + 1}`,
                                        items: (sec.items ?? []).map((it, ii) => ({
                                            id: `${si}-${ii}`,
                                            name: String(it.name ?? ""),
                                            description: String(it.description ?? ""),
                                            price: String(it.price ?? ""),
                                            category: sec.name ?? `Section ${si + 1}`,
                                            dietary: Array.isArray(it.dietary)
                                                ? (it.dietary as string[])
                                                : undefined,
                                            imageUrl:
                                                (it.image_url as string) ??
                                                (it.imageUrl as string) ??
                                                undefined,
                                        })),
                                    }));
                                    useChatStore
                                        .getState()
                                        .dispatchMenu({ type: "SET_SECTIONS", sections: mapped });
                                    // No `break` — the generic handler below
                                    // pushes it as an inline chat segment.
                                }
                                // Evaluation scorecard: populate the flow store
                                // so the Run Report's evaluation tile lights up
                                // live, then FALL THROUGH so the full card also
                                // renders inline in the chat.
                                if (event.component === "EvaluationScorecard") {
                                    useConciergeFlowStore
                                        .getState()
                                        .setEvaluation(event.props as unknown as EvaluationData);
                                    // No `break` — render the inline card too.
                                }
                                // Prompt Optimization showcase: seed the
                                // Baseline_Variant prompt into the store so the
                                // card can show the current configuration, then
                                // FALL THROUGH so the card mounts inline in the
                                // chat. The card reads live per-model state from
                                // the store as prompt_opt events stream.
                                if (event.component === "PromptOptimizationShowcase") {
                                    const p = event.props as Record<string, unknown>;
                                    const baseline =
                                        (p.baselinePrompt as string) ??
                                        (p.baseline_prompt as string) ??
                                        "";
                                    if (baseline) {
                                        usePromptOptimizationStore
                                            .getState()
                                            .setBaselinePrompt(baseline);
                                    }
                                    // No `break` — render the inline card too.
                                }
                                const uiKey = `ui-${(event.props.agent as string) || event.component}`;
                                const existingIdx = segments.findIndex(
                                    (s) => s.type === "ui" && s.key === uiKey
                                );
                                const uiSeg = {
                                    type: "ui" as const,
                                    component: event.component,
                                    props: event.props,
                                    key: uiKey,
                                };
                                if (existingIdx >= 0) {
                                    segments[existingIdx] = uiSeg;
                                } else {
                                    segments.push(uiSeg);
                                }
                                updateMessage();
                                break;
                            }
                            case "payment_spend": {
                                useConciergeFlowStore.getState().setPaymentSpend({
                                    spent: event.spent,
                                    budget: event.budget,
                                    currency: event.currency,
                                    sessions: event.sessions,
                                });
                                break;
                            }
                            case "agent_phase": {
                                // Light the shared Run Report's "Evaluating…"
                                // state the moment the judge phase begins. The
                                // scorecard (setEvaluation) or runtimeEnd clears
                                // it; an evaluator error clears it below.
                                if (event.agent === "evaluator") {
                                    useConciergeFlowStore
                                        .getState()
                                        .setEvaluating(event.status === "start");
                                }
                                if (event.status === "start") {
                                    // Remember the in-flight phase so a terminal
                                    // stream error can close it out (see
                                    // "stream_error") instead of leaving the node
                                    // spinning forever.
                                    activePhaseRef = {
                                        agent: event.agent,
                                        phase: event.phase,
                                    };
                                    researchDispatch({
                                        type: "AGENT_START",
                                        agent: event.agent,
                                        phase: event.phase,
                                    });
                                } else if (event.status === "error") {
                                    researchDispatch({
                                        type: "THINKING",
                                        agent: event.agent,
                                        content: `Agent error in ${event.phase} phase.`,
                                    });
                                    researchDispatch({
                                        type: "AGENT_END",
                                        agent: event.agent,
                                        phase: event.phase,
                                    });
                                    activePhaseRef = null;
                                } else {
                                    researchDispatch({
                                        type: "AGENT_END",
                                        agent: event.agent,
                                        phase: event.phase,
                                    });
                                    activePhaseRef = null;
                                }
                                break;
                            }
                            case "thinking": {
                                researchDispatch({
                                    type: "THINKING",
                                    agent: event.agent,
                                    content: event.content,
                                });
                                break;
                            }
                            case "phase_progress": {
                                researchDispatch({
                                    type: "PHASE_PROGRESS",
                                    phase: event.phase,
                                    progress: event.progress,
                                });
                                break;
                            }
                            case "a2a_call": {
                                // Drive the dedicated A2A flow-panel node through
                                // its lifecycle (Requirement 9). Imperative store
                                // access mirrors the other cases — this runs in the
                                // stream callback, never synchronously in an effect.
                                const flow = useConciergeFlowStore.getState();
                                if (event.status === "start") {
                                    flow.a2aStart(event.identityForwarded);
                                } else if (event.status === "error") {
                                    flow.a2aError();
                                } else {
                                    flow.a2aEnd();
                                }
                                break;
                            }
                            case "prompt_opt": {
                                // Fold per-model optimization and before/after
                                // sample state into the showcase store, and drive
                                // the dedicated flow-panel node through its
                                // lifecycle (design §8). Imperative store access
                                // mirrors the a2a_call case — this runs inside the
                                // stream callback, never synchronously in an
                                // effect body (respecting react-hooks purity).
                                usePromptOptimizationStore.getState().applyEvent(event);
                                const flow = useConciergeFlowStore.getState();
                                if (event.kind === "step_start") {
                                    flow.promptOptStart();
                                } else if (event.kind === "step_failed") {
                                    // Terminal failure: every target model failed.
                                    flow.promptOptFail();
                                }
                                // `step_complete` leaves the node active until a
                                // Selected_Variant is applied (fold: variant_applied
                                // → completed); the remaining kinds update only the
                                // per-model / sample store state above.
                                break;
                            }
                            case "stream_error": {
                                // The orchestrator failed and stopped streaming.
                                // Close the in-flight phase, surface the reason in
                                // its trace, and show a banner — otherwise the UI
                                // spins indefinitely on the failed step.
                                if (activePhaseRef) {
                                    researchDispatch({
                                        type: "THINKING",
                                        agent: activePhaseRef.agent,
                                        content: `Failed: ${event.message}`,
                                    });
                                    researchDispatch({
                                        type: "AGENT_END",
                                        agent: activePhaseRef.agent,
                                        phase: activePhaseRef.phase,
                                    });
                                    activePhaseRef = null;
                                }
                                storeSetError(storeKey, event.message);
                                setMessages(storeKey, (prev) => {
                                    const updated = [...prev];
                                    const last = updated[updated.length - 1];
                                    if (last && last.role === "assistant") {
                                        updated[updated.length - 1] = {
                                            ...last,
                                            content:
                                                `${last.content ?? ""}\n\n**The request could not be completed.** ${event.message}`.trim(),
                                        };
                                    }
                                    return updated;
                                });
                                break;
                            }
                        }
                    },
                    {
                        mode: requestMode,
                        modelId: applied.model_id ?? modelId,
                        ...depthExtra,
                        ...appliedExtra,
                        ...extra,
                    }
                );
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : "Unknown error";
                storeSetError(storeKey, `Failed to get response: ${errorMessage}`);
                console.error("Error invoking AgentCore:", err);

                setMessages(storeKey, (prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                        ...updated[updated.length - 1],
                        content:
                            "I apologize, but I encountered an error processing your request. Please try again.",
                    };
                    return updated;
                });
            } finally {
                setLoading(storeKey, false);
                useConciergeFlowStore.getState().runtimeEnd();
            }
        },
        [client, sessionId, auth.user?.access_token, researchDispatch, modelId, storeKey]
    );

    const sendMessage = useCallback(
        async (userMessage: string): Promise<void> => {
            if (!userMessage.trim() || !client) return;

            useChatStore.getState().setError(storeKey, null);

            const newUserMessage: Message = {
                role: "user",
                content: userMessage,
                timestamp: new Date().toISOString(),
            };

            useChatStore.getState().setMessages(storeKey, (prev) => [...prev, newUserMessage]);
            await _streamResponse(userMessage, mode);
        },
        [client, mode, _streamResponse, storeKey]
    );

    const executeResearchPlan = useCallback(
        async (
            plan: Record<string, unknown>,
            query: string,
            modeOverride?: string,
            paymentBudgetUsd?: string
        ): Promise<void> => {
            if (!client) return;

            useChatStore.getState().setError(storeKey, null);

            // Approving the plan is also the payment authorization — the spend
            // ceiling the user accepted travels with the approval, so the
            // backend never has to infer a budget.
            const approvalMessage: Message = {
                role: "user",
                content: paymentBudgetUsd
                    ? `Approved research plan (paid data budget $${paymentBudgetUsd}). Starting execution...`
                    : "Approved research plan. Starting execution...",
                timestamp: new Date().toISOString(),
            };

            useChatStore.getState().setMessages(storeKey, (prev) => [...prev, approvalMessage]);
            const extra: Record<string, unknown> = { plan };
            if (paymentBudgetUsd) {
                extra.payment_budget_usd = paymentBudgetUsd;
            }
            await _streamResponse(query, modeOverride || "research_execute", extra);
        },
        [client, _streamResponse, storeKey]
    );

    /**
     * Continue the Services Catalog pipeline after the user reviewed it.
     *
     * The catalog passed here is whatever the user approved — including any
     * descriptions they edited or A/B variants they applied — so the exported
     * PDF and website match exactly what they signed off on.
     */
    const exportCatalog = useCallback(
        async (catalog: Record<string, unknown>): Promise<void> => {
            if (!client) return;
            useChatStore.getState().setError(storeKey, null);

            const approvalMessage: Message = {
                role: "user",
                content: "Approved the services catalog. Exporting...",
                timestamp: new Date().toISOString(),
            };
            useChatStore.getState().setMessages(storeKey, (prev) => [...prev, approvalMessage]);
            await _streamResponse("Export the approved services catalog.", "menu_export", {
                catalog,
            });
        },
        [client, _streamResponse, storeKey]
    );

    /**
     * Continuous feedback loop: ask the orchestrator to read recent catalog
     * feedback and propose designer-prompt refinements. Streams a
     * PromptImprovement card the presenter reviews and applies. Does not change
     * the live prompt — applying is a separate, explicit step.
     */
    const optimizeFromFeedback = useCallback(async (): Promise<void> => {
        if (!client) return;
        useChatStore.getState().setError(storeKey, null);
        const triggerMessage: Message = {
            role: "user",
            content: "Improve the catalog designer prompt from recent feedback.",
            timestamp: new Date().toISOString(),
        };
        useChatStore.getState().setMessages(storeKey, (prev) => [...prev, triggerMessage]);
        await _streamResponse(
            "Improve the catalog designer prompt from recent feedback.",
            "menu_optimize"
        );
    }, [client, _streamResponse, storeKey]);

    /**
     * Targeted revision: re-run synthesis on the flagged report to fix only the
     * sub-threshold dimensions the evaluator called out, then re-evaluate. The
     * prior report travels in the payload (the evaluation card carries it) so
     * the reviser has the material to improve without re-researching.
     */
    const reviseReport = useCallback(
        async (payload: {
            report_text?: string;
            weak_dimensions?: unknown[];
            gaps?: string[];
            query?: string;
        }): Promise<void> => {
            if (!client) return;
            useChatStore.getState().setError(storeKey, null);
            const labels = Array.isArray(payload.weak_dimensions)
                ? payload.weak_dimensions
                      .map((d) =>
                          d && typeof d === "object" ? (d as { label?: string }).label : undefined
                      )
                      .filter(Boolean)
                      .join(", ")
                : "";
            const triggerMessage: Message = {
                role: "user",
                content: labels
                    ? `Revise the report to fix the flagged areas: ${labels}.`
                    : "Revise the report to fix the flagged areas.",
                timestamp: new Date().toISOString(),
            };
            useChatStore.getState().setMessages(storeKey, (prev) => [...prev, triggerMessage]);
            await _streamResponse(
                payload.query || "Revise the flagged research report.",
                "research_revise",
                {
                    report_text: payload.report_text ?? "",
                    weak_dimensions: payload.weak_dimensions ?? [],
                    gaps: payload.gaps ?? [],
                }
            );
        },
        [client, _streamResponse, storeKey]
    );

    const startNewChat = useCallback((): void => {
        useChatStore.getState().clearSlot(storeKey);
        useConciergeFlowStore.getState().reset();
        useBrowserLiveViewStore.getState().close();
        // Drop any applied Prompt Optimization variant so a fresh chat starts
        // on the Current_Model + Current_System_Prompt (Req 8.3, 13.3).
        usePromptOptimizationStore.getState().clear();
        // Drop any applied feedback-derived designer refinement too.
        usePromptImprovementStore.getState().clear();
    }, [storeKey]);

    const clearError = useCallback((): void => {
        useChatStore.getState().setError(storeKey, null);
    }, [storeKey]);

    return {
        messages,
        sendMessage,
        executeResearchPlan,
        exportCatalog,
        optimizeFromFeedback,
        reviseReport,
        isLoading,
        error,
        clearError,
        sessionId,
        startNewChat,
        isReady: client !== null,
    };
}
