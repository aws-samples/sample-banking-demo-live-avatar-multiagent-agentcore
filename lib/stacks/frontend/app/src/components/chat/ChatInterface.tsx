import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatHeader } from "./ChatHeader";
import { ChatInput } from "./ChatInput";
import { ChatMessages } from "./ChatMessages";
import { WelcomeScreen } from "./WelcomeScreen";

import { useChatEngine } from "@/hooks/useChatEngine";
import { useDefaultTool, useToolRenderer } from "@/hooks/useToolRenderer";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { KbSearchResultCard } from "./KbSearchResultCard";
import { ConciergeFlowSidebar } from "@/components/concierge-flow/ConciergeFlowSidebar";
import { useConciergeFlowStore } from "@/stores/conciergeFlowStore";
import { BrowserLiveViewSidebar } from "./BrowserLiveViewSidebar";
import { useBrowserLiveViewStore } from "@/stores/browserLiveViewStore";
import ResizablePanelLayout, {
    type ResizablePanelConfig,
} from "@/components/common/resizable/ResizablePanelLayout";

import { submitFeedback } from "@/services/feedbackService";
import { useAuth } from "react-oidc-context";
import Alert from "@cloudscape-design/components/alert";

interface ChatInterfaceProps {
    /** Render prop for custom welcome screen. Receives onExampleClick to wire up example cards. */
    renderWelcome?: (onExampleClick: (question: string) => void) => React.ReactNode;
    /** Agent mode */
    mode?: "research" | "chatbot" | "menu" | "generic_research" | "archive_chat";
    /** Title shown in the ChatHeader. Defaults to "Research Agent". */
    title?: string;
    /** When true, shows the live AgentCore flow sidebar toggle in the header. */
    enableFlowSidebar?: boolean;
}

export default function ChatInterface({
    renderWelcome,
    mode,
    title,
    enableFlowSidebar,
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
        <KbSearchResultCard name={name} args={args} status={status} result={result} />
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
                executeResearchPlan(plan, query, modeOverride);
            } else if (action === "start_over") {
                startNewChat();
                setInput("");
            }
        },
        [executeResearchPlan, startNewChat, mode]
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
    // Constraints are deliberately loose so the drag bar has a wide usable range on any viewport.
    // - main: can shrink to 5% (mostly-collapsed chat) but not vanish
    // - flow: 10-70% so it can grow to dominate the view for deep-flow debugging
    // - browser: 15-75% so the live view can take over when the user is watching the agent
    const panelConfigs = useMemo(() => {
        const configs: ResizablePanelConfig[] = [{ id: "chat-main", defaultSize: 60, minSize: 5 }];
        if (showFlowPanel) {
            configs.push({ id: "chat-flow", defaultSize: 22, minSize: 10, maxSize: 70 });
        }
        if (showBrowserPanel) {
            configs.push({ id: "chat-browser", defaultSize: 25, minSize: 15, maxSize: 75 });
        }
        // Re-normalise defaults so they sum to 100 (required by react-resizable-panels).
        const total = configs.reduce((s, c) => s + c.defaultSize, 0);
        return configs.map((c) => ({ ...c, defaultSize: (c.defaultSize / total) * 100 }));
    }, [showFlowPanel, showBrowserPanel]);

    return (
        <ResizablePanelLayout
            autoSaveId="chat-v2"
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
