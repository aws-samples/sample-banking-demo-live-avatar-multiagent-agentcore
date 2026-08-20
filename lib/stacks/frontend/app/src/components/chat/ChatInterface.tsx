import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatHeader } from "./ChatHeader";
import { ChatInput } from "./ChatInput";
import { ChatMessages } from "./ChatMessages";
import { WelcomeScreen } from "./WelcomeScreen";

import { useChatEngine } from "@/hooks/useChatEngine";
import { useDefaultTool, useToolRenderer } from "@/hooks/useToolRenderer";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { KbSearchResultCard } from "./KbSearchResultCard";
import { KbImageStrip } from "./KbImageStrip";
import { ConciergeFlowSidebar } from "@/components/concierge-flow/ConciergeFlowSidebar";
import { useConciergeFlowStore } from "@/stores/conciergeFlowStore";
import { usePromptImprovementStore } from "@/stores/usePromptImprovementStore";
import { BrowserLiveViewSidebar } from "./BrowserLiveViewSidebar";
import { useBrowserLiveViewStore } from "@/stores/browserLiveViewStore";
import ResizablePanelLayout, {
    type ResizablePanelConfig,
} from "@/components/common/resizable/ResizablePanelLayout";

import { submitFeedback } from "@/services/feedbackService";
import { useAuth } from "react-oidc-context";
import Alert from "@cloudscape-design/components/alert";
import type { SamplePrompt } from "@/config/samplePrompts";

interface ChatInterfaceProps {
    /** Render prop for custom welcome screen. Receives onExampleClick to wire up example cards. */
    renderWelcome?: (onExampleClick: (question: string) => void) => React.ReactNode;
    /** Agent mode */
    mode?: "research" | "chatbot" | "menu" | "generic_research" | "archive_chat";
    /** Title shown in the ChatHeader. Defaults to "Research Agent". */
    title?: string;
    /** When true, shows the live AgentCore flow sidebar toggle in the header. */
    enableFlowSidebar?: boolean;
    /** Sample prompts for the always-available picker in the input row. */
    samplePrompts?: SamplePrompt[];
}

export default function ChatInterface({
    renderWelcome,
    mode,
    title,
    enableFlowSidebar,
    samplePrompts,
}: ChatInterfaceProps): JSX.Element {
    const [input, setInput] = useState("");
    const [flowOpen, setFlowOpen] = useState(false);
    const auth = useAuth();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const isNearBottomRef = useRef(true);
    const runtimeActive = useConciergeFlowStore((s) => s.runtimeActive);

    const {
        messages,
        sendMessage,
        executeResearchPlan,
        exportCatalog,
        launchCatalogEvaluation,
        optimizeFromFeedback,
        reviseReport,
        isLoading,
        error,
        clearError,
        sessionId,
        startNewChat,
    } = useChatEngine({ mode });

    useDefaultTool(({ name, args, status, result }) => (
        <ToolCallDisplay name={name} args={args} status={status} result={result} />
    ));

    useToolRenderer("kb_search", ({ name, args, status, result }) => (
        <>
            <KbSearchResultCard name={name} args={args} status={status} result={result} />
            {/* Multimodal KB images render alongside the source documents; no-ops
                when the result carries no `images` (multimodal retrieval off). */}
            <KbImageStrip name={name} args={args} status={status} result={result} />
        </>
    ));

    useEffect(() => {
        if (isNearBottomRef.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages]);

    const handleSubmit = (e: React.FormEvent): void => {
        e.preventDefault();
        sendMessage(input);
        setInput("");
        isNearBottomRef.current = true;
    };

    const handleExampleClick = (question: string): void => {
        sendMessage(question);
    };

    const handleFeedbackSubmit = async (
        messageContent: string,
        feedbackType: "positive" | "negative",
        comment: string
    ): Promise<void> => {
        try {
            const idToken = auth.user?.id_token;

            if (!idToken) {
                throw new Error("Authentication required. Please log in again.");
            }

            await submitFeedback(
                {
                    sessionId,
                    message: messageContent,
                    feedbackType,
                    comment: comment || undefined,
                    metadata: { source: "chat_rating" },
                },
                idToken
            );

            console.log("Feedback submitted successfully");
        } catch (err) {
            console.error("Error submitting feedback:", err);
        }
    };

    const handleUIAction = useCallback(
        (action: string, data: unknown): void => {
            const payload = data as Record<string, unknown>;
            if (action === "research_execute") {
                const plan = payload.plan as Record<string, unknown>;
                const query = payload.query as string;
                // Route to generic_research_execute when in generic_research mode
                const modeOverride =
                    mode === "generic_research" ? "generic_research_execute" : undefined;
                executeResearchPlan(
                    plan,
                    query,
                    modeOverride,
                    payload.paymentBudgetUsd as string | undefined
                );
            } else if (action === "menu_export") {
                // The reviewed catalog — including any edits — continues into
                // the export phases.
                exportCatalog(payload.catalog as Record<string, unknown>);
            } else if (action === "catalog_evaluate") {
                // Managed A/B: launch two real Bedrock model-as-a-judge jobs
                // over the current catalog copy; scorecards live in the console.
                launchCatalogEvaluation(payload.catalog as Record<string, unknown>);
            } else if (action === "research_revise") {
                // Targeted revision: re-synthesize the flagged report to lift
                // its sub-threshold dimensions, then re-evaluate.
                reviseReport({
                    report_text: payload.report_text as string | undefined,
                    weak_dimensions: (payload.weak_dimensions as unknown[]) ?? [],
                    gaps: (payload.gaps as string[]) ?? [],
                    query: payload.query as string | undefined,
                });
            } else if (action === "optimize_from_feedback") {
                // Continuous feedback loop: propose designer-prompt refinements
                // from the reviewer feedback captured so far.
                optimizeFromFeedback();
            } else if (action === "apply_prompt_improvement") {
                // Human-in-the-loop apply: store the refinement so the next
                // catalog run uses it, and log it as a feedback signal so the
                // loop's "Improve" stage reflects that the prompt was updated.
                const refinements = (payload.refinements as string[]) ?? [];
                const signalCount = (payload.signalCount as number) ?? 0;
                usePromptImprovementStore.getState().apply(refinements, signalCount);
                const idToken = auth.user?.id_token;
                if (idToken) {
                    void submitFeedback(
                        {
                            sessionId,
                            message: "Applied a feedback-derived designer prompt refinement.",
                            feedbackType: "positive",
                            metadata: { source: "prompt_update", experience: "menu" },
                        },
                        idToken
                    ).catch(() => undefined);
                }
            } else if (action === "start_over") {
                startNewChat();
                setInput("");
            }
        },
        [
            executeResearchPlan,
            exportCatalog,
            launchCatalogEvaluation,
            optimizeFromFeedback,
            reviseReport,
            startNewChat,
            mode,
            auth.user?.id_token,
            sessionId,
        ]
    );

    const handleNewChat = (): void => {
        startNewChat();
        setInput("");
        isNearBottomRef.current = true;
    };

    const handleScroll = useCallback((): void => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const threshold = 150;
        isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    }, []);

    // Auto-open the flow sidebar when the first message is sent.
    const hasAutoOpened = useRef(false);
    useEffect(() => {
        if (!enableFlowSidebar || hasAutoOpened.current) return;
        if (messages.length > 0) {
            setFlowOpen(true);
            hasAutoOpened.current = true;
        }
    }, [messages.length, enableFlowSidebar]);

    const isInitialState = messages.length === 0;
    const hasAssistantMessages = messages.some((message) => message.role === "assistant");

    // ── Compute which side panels are present so the resizable layout only allocates panels for live nodes.
    const browserLiveViewUrl = useBrowserLiveViewStore((s) => s.liveViewUrl);
    const showFlowPanel = !!enableFlowSidebar && flowOpen;
    const showBrowserPanel = !!browserLiveViewUrl;

    // Panel configs — defaults are percentages; the remainder after sidebars goes to the main chat.
    // Constraints are deliberately minimal (5% floor, no maxSize) so the divider can slide all
    // the way across the viewport. The flow-open toggle button handles the "snap closed" case.
    const panelConfigs = useMemo(() => {
        const configs: ResizablePanelConfig[] = [{ id: "chat-main", defaultSize: 60, minSize: 5 }];
        if (showFlowPanel) {
            configs.push({ id: "chat-flow", defaultSize: 22, minSize: 5 });
        }
        if (showBrowserPanel) {
            configs.push({ id: "chat-browser", defaultSize: 25, minSize: 5 });
        }
        // Re-normalise defaults so they sum to 100 (required by react-resizable-panels).
        const total = configs.reduce((s, c) => s + c.defaultSize, 0);
        return configs.map((c) => ({ ...c, defaultSize: (c.defaultSize / total) * 100 }));
    }, [showFlowPanel, showBrowserPanel]);

    return (
        <ResizablePanelLayout
            autoSaveId="chat-v3"
            direction="horizontal"
            panels={panelConfigs}
            className="h-full w-full"
        >
            <div className="flex flex-col h-full w-full min-w-0">
                <div className="flex-none">
                    <ChatHeader
                        title={title}
                        onNewChat={handleNewChat}
                        canStartNewChat={hasAssistantMessages}
                        mode={mode}
                        onToggleFlow={enableFlowSidebar ? () => setFlowOpen((v) => !v) : undefined}
                        flowOpen={flowOpen}
                        flowPulse={enableFlowSidebar && runtimeActive && !flowOpen}
                    />
                    {error && (
                        <div className="mx-4 mt-2">
                            <Alert type="error" dismissible onDismiss={clearError}>
                                {error}
                            </Alert>
                        </div>
                    )}
                </div>

                {isInitialState ? (
                    <>
                        <div className="grow overflow-y-auto">
                            {renderWelcome ? (
                                renderWelcome(handleExampleClick)
                            ) : (
                                <WelcomeScreen onExampleClick={handleExampleClick} />
                            )}
                        </div>
                        <div className="flex-none">
                            <div className="px-4 mb-4 max-w-4xl mx-auto w-full">
                                <ChatInput
                                    input={input}
                                    setInput={setInput}
                                    handleSubmit={handleSubmit}
                                    isLoading={isLoading}
                                    samplePrompts={samplePrompts}
                                    onPickSample={handleExampleClick}
                                />
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="grow overflow-hidden">
                            <div className="max-w-4xl mx-auto w-full h-full">
                                <ChatMessages
                                    messages={messages}
                                    messagesEndRef={messagesEndRef}
                                    scrollContainerRef={scrollContainerRef}
                                    onScroll={handleScroll}
                                    sessionId={sessionId}
                                    onFeedbackSubmit={handleFeedbackSubmit}
                                    onUIAction={handleUIAction}
                                />
                            </div>
                        </div>
                        <div className="flex-none">
                            <div className="max-w-4xl mx-auto w-full">
                                <ChatInput
                                    input={input}
                                    setInput={setInput}
                                    handleSubmit={handleSubmit}
                                    isLoading={isLoading}
                                    samplePrompts={samplePrompts}
                                    onPickSample={handleExampleClick}
                                />
                            </div>
                        </div>
                    </>
                )}
            </div>
            {showFlowPanel ? <ConciergeFlowSidebar onClose={() => setFlowOpen(false)} /> : null}
            {showBrowserPanel ? <BrowserLiveViewSidebar /> : null}
        </ResizablePanelLayout>
    );
}
