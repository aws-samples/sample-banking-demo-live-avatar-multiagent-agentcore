import { RefObject } from "react";
import { Message } from "./types";
import { ChatMessage } from "./ChatMessage";

interface ChatMessagesProps {
    messages: Message[];
    messagesEndRef: RefObject<HTMLDivElement | null>;
    sessionId: string;
    onFeedbackSubmit: (
        messageContent: string,
        feedbackType: "positive" | "negative",
        comment: string
    ) => Promise<void>;
    onUIAction?: (action: string, data: unknown) => void;
}

export function ChatMessages({
    messages,
    messagesEndRef,
    sessionId,
    onFeedbackSubmit,
    onUIAction,
}: ChatMessagesProps): JSX.Element {
    return (
        <div
            className={`h-full p-4 space-y-4 w-full ${
                messages.length > 0 ? "overflow-y-auto" : "overflow-hidden"
            }`}
        >
            {messages.length === 0 ? (
                <div
                    className="flex items-center justify-center h-full"
                    style={{ color: "var(--app-text-secondary)" }}
                >
                    Start a new conversation
                </div>
            ) : (
                messages.map((message, index) => (
                    <ChatMessage
                        key={index}
                        message={message}
                        sessionId={sessionId}
                        onFeedbackSubmit={async (feedbackType, comment) => {
                            await onFeedbackSubmit(message.content, feedbackType, comment);
                        }}
                        onUIAction={onUIAction}
                    />
                ))
            )}
            <div ref={messagesEndRef} />
        </div>
    );
}
