import { useEffect, useRef, useState, useCallback } from "react";
import { Message, MessageSegment, ToolCall } from "@/components/chat/types";
import { AgentCoreClient } from "@/lib/agentcore-client";
import type { AgentPattern, StreamEvent } from "@/lib/agentcore-client";
import { useAuth } from "react-oidc-context";
import { useModelSelector } from "@/hooks/useModelSelector";
import { useChatStore } from "@/stores/chatStore";
import type { ResearchAction } from "@/stores/chatStore";

export type { ResearchAction };

export interface UseChatEngineOptions {
    onResearchEvent?: (action: ResearchAction) => void;
    /** Agent mode sent in the payload */
    mode?: "research" | "chatbot" | "menu" | "generic_research" | "archive_chat";
}

export interface UseChatEngineReturn {
    messages: Message[];
    sendMessage: (text: string) => Promise<void>;
    executeResearchPlan: (
        plan: Record<string, unknown>,
        query: string,
        modeOverride?: string
    ) => Promise<void>;
    isLoading: boolean;
    error: string | null;
    clearError: () => void;
    sessionId: string;
    startNewChat: () => void;
    isReady: boolean;
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
        const runtimeArn = import.meta.env.VITE_RUNTIME_ARN_ORCHESTRATOR;
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
    }, [storeKey]);

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
                            case "agent_phase": {
                                if (event.status === "start") {
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
                                } else {
                                    researchDispatch({
                                        type: "AGENT_END",
                                        agent: event.agent,
                                        phase: event.phase,
                                    });
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
                        }
                    },
                    { mode: requestMode, modelId, ...depthExtra, ...extra }
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
            modeOverride?: string
        ): Promise<void> => {
            if (!client) return;

            useChatStore.getState().setError(storeKey, null);

            // Add a user message showing the plan was approved
            const approvalMessage: Message = {
                role: "user",
                content: "Approved research plan. Starting execution...",
                timestamp: new Date().toISOString(),
            };

            useChatStore.getState().setMessages(storeKey, (prev) => [...prev, approvalMessage]);
            await _streamResponse(query, modeOverride || "research_execute", { plan });
        },
        [client, _streamResponse, storeKey]
    );

    const startNewChat = useCallback((): void => {
        useChatStore.getState().clearSlot(storeKey);
    }, [storeKey]);

    const clearError = useCallback((): void => {
        useChatStore.getState().setError(storeKey, null);
    }, [storeKey]);

    return {
        messages,
        sendMessage,
        executeResearchPlan,
        isLoading,
        error,
        clearError,
        sessionId,
        startNewChat,
        isReady: client !== null,
    };
}
