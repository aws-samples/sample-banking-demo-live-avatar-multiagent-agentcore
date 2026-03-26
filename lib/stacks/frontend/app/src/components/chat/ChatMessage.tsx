import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { Message } from "./types";
import { FeedbackDialog } from "./FeedbackDialog";
import { getToolRenderer } from "@/hooks/useToolRenderer";
import { StructuredContentRenderer } from "./structured";
import { getUIComponent } from "./ui-components";
import Button from "@cloudscape-design/components/button";

interface ChatMessageProps {
    message: Message;
    sessionId: string;
    onFeedbackSubmit: (feedbackType: "positive" | "negative", comment: string) => Promise<void>;
    onUIAction?: (action: string, data: unknown) => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ChatMessage({
    message,
    sessionId: _sessionId,
    onFeedbackSubmit,
    onUIAction,
}: ChatMessageProps): JSX.Element {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedFeedbackType, setSelectedFeedbackType] = useState<"positive" | "negative">(
        "positive"
    );
    const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

    const formatTime = (timestamp: string): string => {
        return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    };

    const handleFeedbackClick = (type: "positive" | "negative"): void => {
        setSelectedFeedbackType(type);
        setIsDialogOpen(true);
    };

    const handleFeedbackSubmit = async (comment: string): Promise<void> => {
        await onFeedbackSubmit(selectedFeedbackType, comment);
        setFeedbackSubmitted(true);
    };

    const renderAssistantContent = (): JSX.Element | (JSX.Element | null)[] | null => {
        if (message.segments && message.segments.length > 0) {
            return message.segments.map((seg, i) => {
                if (seg.type === "text") {
                    return <StructuredContentRenderer key={i} content={seg.content} />;
                }
                if (seg.type === "ui") {
                    const UIComponent = getUIComponent(seg.component);
                    if (!UIComponent) return null;
                    return <UIComponent key={seg.key} {...seg.props} onAction={onUIAction} />;
                }
                const render = getToolRenderer(seg.toolCall.name);
                if (!render) return null;
                return (
                    <div key={seg.toolCall.toolUseId} className="my-1">
                        {render({
                            name: seg.toolCall.name,
                            args: seg.toolCall.input,
                            status: seg.toolCall.status,
                            result: seg.toolCall.result,
                        })}
                    </div>
                );
            });
        }
        return <StructuredContentRenderer content={message.content} />;
    };

    return (
        <div className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
            <div
                className={`max-w-[80%] break-words ${
                    message.role === "user"
                        ? "p-3 rounded-xl rounded-br-none whitespace-pre-wrap"
                        : ""
                }`}
                style={
                    message.role === "user"
                        ? {
                              background: "var(--app-user-bubble)",
                              color: "var(--app-user-bubble-text)",
                              boxShadow: "var(--card-shadow)",
                          }
                        : { color: "var(--app-text)" }
                }
            >
                {message.role === "assistant" ? renderAssistantContent() : message.content}
            </div>

            <div className="flex items-center gap-2 mt-1 px-1">
                <div className="text-xs" style={{ color: "var(--app-text-secondary)" }}>
                    {formatTime(message.timestamp)}
                </div>

                {message.role === "assistant" && message.content && (
                    <div className="flex items-center gap-1 ml-2">
                        <Button
                            variant="icon"
                            iconSvg={<ThumbsUp size={14} />}
                            onClick={() => handleFeedbackClick("positive")}
                            disabled={feedbackSubmitted}
                            ariaLabel="Positive feedback"
                        />
                        <Button
                            variant="icon"
                            iconSvg={<ThumbsDown size={14} />}
                            onClick={() => handleFeedbackClick("negative")}
                            disabled={feedbackSubmitted}
                            ariaLabel="Negative feedback"
                        />
                        {feedbackSubmitted && (
                            <span
                                className="text-xs ml-1"
                                style={{ color: "var(--app-text-secondary)" }}
                            >
                                Thanks for your feedback!
                            </span>
                        )}
                    </div>
                )}
            </div>

            <FeedbackDialog
                isOpen={isDialogOpen}
                onClose={() => setIsDialogOpen(false)}
                onSubmit={handleFeedbackSubmit}
                feedbackType={selectedFeedbackType}
            />
        </div>
    );
}
