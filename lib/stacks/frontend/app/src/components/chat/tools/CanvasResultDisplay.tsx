import { useState } from "react";
import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";

interface CanvasResultDisplayProps {
    imageUrl: string;
    prompt?: string;
}

export default function CanvasResultDisplay({ imageUrl, prompt }: CanvasResultDisplayProps) {
    const [expanded, setExpanded] = useState(false);

    return (
        <>
            <div className="inline-block">
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="block cursor-pointer rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors"
                >
                    <img
                        src={imageUrl}
                        alt={prompt ?? "Generated image"}
                        className="max-h-48 w-auto object-contain"
                    />
                </button>
                {prompt && (
                    <Box
                        variant="p"
                        color="text-body-secondary"
                        fontSize="body-s"
                        margin={{ top: "xs" }}
                    >
                        {prompt}
                    </Box>
                )}
            </div>

            <Modal
                visible={expanded}
                onDismiss={() => setExpanded(false)}
                header="Generated Image"
                size="large"
                footer={
                    <Box float="right">
                        <Button onClick={() => setExpanded(false)}>Close</Button>
                    </Box>
                }
            >
                <div className="flex justify-center">
                    <img
                        src={imageUrl}
                        alt={prompt ?? "Generated image"}
                        className="max-w-full max-h-[70vh] object-contain"
                    />
                </div>
                {prompt && (
                    <Box variant="p" color="text-body-secondary" margin={{ top: "s" }}>
                        {prompt}
                    </Box>
                )}
            </Modal>
        </>
    );
}
