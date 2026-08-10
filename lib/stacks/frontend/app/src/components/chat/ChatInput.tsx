import { FormEvent, KeyboardEvent, useRef, useEffect } from "react";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import { Loader2Icon, Lightbulb } from "lucide-react";
import type { SamplePrompt } from "@/config/samplePrompts";

interface ChatInputProps {
    input: string;
    setInput: (input: string) => void;
    handleSubmit: (e: FormEvent) => void;
    isLoading: boolean;
    className?: string;
    /** Sample prompts for the always-available picker. Hidden when empty. */
    samplePrompts?: SamplePrompt[];
    /** Fires the chosen sample prompt (defaults to filling the input). */
    onPickSample?: (question: string) => void;
}

export function ChatInput({
    input,
    setInput,
    handleSubmit,
    isLoading,
    className = "",
    samplePrompts,
    onPickSample,
}: ChatInputProps): JSX.Element {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = "0px";
            const scrollHeight = textarea.scrollHeight;
            textarea.style.height = scrollHeight + "px";
        }
    }, [input]);

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
        if (e.key === "Enter") {
            if (e.ctrlKey) {
                setInput(`${input}\n\n`);
                e.preventDefault();
            } else if (!e.shiftKey) {
                if (input.trim()) {
                    e.preventDefault();
                    handleSubmit(e as unknown as FormEvent);
                }
            }
        }
    };

    const hasSamples = !!samplePrompts && samplePrompts.length > 0;

    return (
        <div className={`p-4 w-full ${className}`}>
            {hasSamples && (
                <div className="mb-2 flex justify-end">
                    <ButtonDropdown
                        expandableGroups
                        disabled={isLoading}
                        items={samplePrompts.map((p, i) => ({
                            id: String(i),
                            text: p.label,
                            description: p.question,
                        }))}
                        onItemClick={({ detail }) => {
                            const picked = samplePrompts[Number(detail.id)];
                            if (!picked) return;
                            if (onPickSample) onPickSample(picked.question);
                            else setInput(picked.question);
                        }}
                    >
                        <span className="inline-flex items-center gap-1.5">
                            <Lightbulb size={14} /> Sample prompts
                        </span>
                    </ButtonDropdown>
                </div>
            )}
            <form
                onSubmit={handleSubmit}
                className="flex space-x-2 w-full items-end rounded-xl p-3"
                style={{
                    background: "var(--glass-bg-strong)",
                    backdropFilter: "var(--glass-blur)",
                    WebkitBackdropFilter: "var(--glass-blur)",
                    border: "1px solid var(--glass-border)",
                    boxShadow: "var(--glass-shadow-input)",
                }}
            >
                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your message... (Ctrl+Enter for new line)"
                    disabled={isLoading}
                    className="flex-1 min-h-[40px] max-h-[200px] resize-none py-2 px-3 text-sm border-none outline-none bg-transparent"
                    style={{ color: "var(--app-text)" }}
                    rows={1}
                    autoFocus
                />

                <Button
                    variant="primary"
                    disabled={!input.trim() || isLoading}
                    onClick={(e) => {
                        e.preventDefault();
                        handleSubmit(e as unknown as FormEvent);
                    }}
                    iconName={isLoading ? undefined : "send"}
                >
                    {isLoading ? (
                        <>
                            <Loader2Icon className="mr-2 h-4 w-4 animate-spin inline" />
                            Thinking...
                        </>
                    ) : (
                        "Send"
                    )}
                </Button>
            </form>
        </div>
    );
}
