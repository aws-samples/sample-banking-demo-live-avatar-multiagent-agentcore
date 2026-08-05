/**
 * "Examples" popout for the Voice Avatar.
 *
 * The starter cards only render while the transcript is empty, so the moment a
 * conversation begins the prompt reference disappears — awkward when someone is
 * presenting and needs to see what the agent can actually do. This keeps the
 * same list one click away for the whole session.
 *
 * Cloudscape's Modal supplies the dialog role, focus trap, labelling and Escape
 * handling, so the accessible behaviour is not reimplemented here.
 */

import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { PROMPT_GROUPS } from "./avatarPrompts";

interface AvatarPromptsDialogProps {
    visible: boolean;
    onDismiss: () => void;
    /** Sends the prompt. The dialog closes itself so the reply is visible. */
    onSelect: (prompt: string) => void;
    disabled?: boolean;
}

export default function AvatarPromptsDialog({
    visible,
    onDismiss,
    onSelect,
    disabled,
}: AvatarPromptsDialogProps): JSX.Element {
    const send = (prompt: string) => {
        onSelect(prompt);
        onDismiss();
    };

    return (
        <Modal
            visible={visible}
            onDismiss={onDismiss}
            header="Example prompts"
            closeAriaLabel="Close example prompts"
            footer={
                <Box float="right">
                    <Button variant="link" onClick={onDismiss}>
                        Close
                    </Button>
                </Box>
            }
        >
            <SpaceBetween size="l">
                <Box variant="small" color="text-body-secondary">
                    {disabled
                        ? "Connect to send one of these, or use them as a reference."
                        : "Select a prompt to send it, or use them as a reference."}
                </Box>

                {PROMPT_GROUPS.map((group) => {
                    const Icon = group.icon;
                    return (
                        <div key={group.title}>
                            <div className="flex items-center gap-2 mb-2">
                                <Icon
                                    className="w-4 h-4"
                                    style={{ color: "var(--app-text-secondary)" }}
                                />
                                <Box variant="h4" fontSize="heading-xs">
                                    {group.title}
                                </Box>
                            </div>
                            <SpaceBetween size="xs">
                                {group.prompts.map((p) => (
                                    <Button
                                        key={p.label}
                                        variant="normal"
                                        fullWidth
                                        disabled={disabled}
                                        onClick={() => send(p.prompt)}
                                    >
                                        {p.prompt}
                                    </Button>
                                ))}
                            </SpaceBetween>
                        </div>
                    );
                })}
            </SpaceBetween>
        </Modal>
    );
}
