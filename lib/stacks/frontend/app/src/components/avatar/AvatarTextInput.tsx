/**
 * Text input for sending messages to the avatar WebSocket.
 * Provides a Cloudscape Input + Button in a horizontal row.
 */

import { useState, useCallback } from "react";
import Input from "@cloudscape-design/components/input";
import Button from "@cloudscape-design/components/button";
import { Send } from "lucide-react";

interface AvatarTextInputProps {
    onSend: (text: string) => void;
    disabled?: boolean;
}

export default function AvatarTextInput({ onSend, disabled }: AvatarTextInputProps): JSX.Element {
    const [text, setText] = useState("");

    const handleSend = useCallback(() => {
        const trimmed = text.trim();
        if (!trimmed) return;
        onSend(trimmed);
        setText("");
    }, [text, onSend]);

    const handleKeyDown = useCallback(
        (event: CustomEvent<{ key: string }>) => {
            if (event.detail.key === "Enter") {
                handleSend();
            }
        },
        [handleSend]
    );

    return (
        <div className="flex items-center gap-2 w-full">
            <div className="flex-1">
                <Input
                    value={text}
                    onChange={({ detail }) => setText(detail.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message..."
                    disabled={disabled}
                />
            </div>
            <Button
                variant="primary"
                onClick={handleSend}
                disabled={disabled || !text.trim()}
                iconSvg={<Send size={16} />}
            >
                Send
            </Button>
        </div>
    );
}
