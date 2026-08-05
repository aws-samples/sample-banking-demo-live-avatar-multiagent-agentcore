/**
 * Suggested starter prompts shown in the Voice Avatar transcript before any
 * interaction. Clicking a card sends the prompt through the same text
 * pipeline that AvatarTextInput uses, so it works identically whether the
 * user clicks or types.
 *
 * The prompt list itself lives in `avatarPrompts.ts`, shared with the
 * "Examples" popout that keeps them reachable once the transcript takes over.
 */

import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import { PROMPT_GROUPS } from "./avatarPrompts";

interface AvatarSuggestedPromptsProps {
    onSelect: (prompt: string) => void;
    disabled?: boolean;
}

export default function AvatarSuggestedPrompts({
    onSelect,
    disabled,
}: AvatarSuggestedPromptsProps): JSX.Element {
    return (
        <div className="avatar-page__suggestions">
            <Header variant="h3">Try asking</Header>
            <Box variant="small" color="text-body-secondary" margin={{ bottom: "m" }}>
                Tap any card to send it, or speak/type your own.
            </Box>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PROMPT_GROUPS.map((group) => {
                    const Icon = group.icon;
                    return (
                        <div key={group.title} className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <Icon
                                    className="w-4 h-4"
                                    style={{ color: "var(--app-text-secondary)" }}
                                />
                                <Box variant="h4" fontSize="heading-xs">
                                    {group.title}
                                </Box>
                            </div>
                            {group.prompts.map((p) => (
                                <button
                                    key={p.label}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => onSelect(p.prompt)}
                                    className="text-left cursor-pointer bg-transparent border-0 p-0 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <Container
                                        header={
                                            <Header variant="h3" description={p.prompt}>
                                                {p.label}
                                            </Header>
                                        }
                                    />
                                </button>
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
