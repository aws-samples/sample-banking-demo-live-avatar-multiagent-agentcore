import { useState } from "react";
import Modal from "@cloudscape-design/components/modal";
import Button from "@cloudscape-design/components/button";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import FormField from "@cloudscape-design/components/form-field";
import Textarea from "@cloudscape-design/components/textarea";

interface FeedbackDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (comment: string) => void;
    feedbackType: "positive" | "negative";
}

export function FeedbackDialog({
    isOpen,
    onClose,
    onSubmit,
    feedbackType,
}: FeedbackDialogProps): JSX.Element {
    const [comment, setComment] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (): Promise<void> => {
        setIsSubmitting(true);
        try {
            await onSubmit(comment);
            setComment("");
            onClose();
        } catch (error) {
            console.error("Error submitting feedback:", error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCancel = (): void => {
        setComment("");
        onClose();
    };

    return (
        <Modal
            visible={isOpen}
            onDismiss={handleCancel}
            header={feedbackType === "positive" ? "Positive Feedback" : "Negative Feedback"}
            footer={
                <Box float="right">
                    <SpaceBetween direction="horizontal" size="xs">
                        <Button variant="link" onClick={handleCancel} disabled={isSubmitting}>
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            onClick={handleSubmit}
                            disabled={isSubmitting}
                            loading={isSubmitting}
                        >
                            Send
                        </Button>
                    </SpaceBetween>
                </Box>
            }
        >
            <FormField
                label="Tell us more about your experience (optional)"
                constraintText={`${comment.length} / 5000`}
            >
                <Textarea
                    value={comment}
                    onChange={({ detail }) => setComment(detail.value)}
                    placeholder="Share your thoughts..."
                    rows={4}
                />
            </FormField>
        </Modal>
    );
}
