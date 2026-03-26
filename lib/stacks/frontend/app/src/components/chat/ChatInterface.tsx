import { useCallback, useEffect, useRef, useState } from "react";
import { ChatHeader } from "./ChatHeader";
import { ChatInput } from "./ChatInput";
import { ChatMessages } from "./ChatMessages";
import { WelcomeScreen } from "./WelcomeScreen";

import { useChatEngine } from "@/hooks/useChatEngine";
import { useDefaultTool, useToolRenderer } from "@/hooks/useToolRenderer";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { KbSearchResultCard } from "./KbSearchResultCard";

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
}

export default function ChatInterface({
    renderWelcome,
    mode,
    title,
}: ChatInterfaceProps): JSX.Element {
    const [input, setInput] = useState("");
    const auth = useAuth();
    const messagesEndRef = useRef<HTMLDivElement>(null);

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
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSubmit = (e: React.FormEvent): void => {
        e.preventDefault();
        sendMessage(input);
        setInput("");
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
    };

    const isInitialState = messages.length === 0;
    const hasAssistantMessages = messages.some((message) => message.role === "assistant");

    return (
        <div className="flex flex-col h-full w-full">
            <div className="flex-none">
                <ChatHeader
                    title={title}
                    onNewChat={handleNewChat}
                    canStartNewChat={hasAssistantMessages}
                    mode={mode}
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
    );
}
