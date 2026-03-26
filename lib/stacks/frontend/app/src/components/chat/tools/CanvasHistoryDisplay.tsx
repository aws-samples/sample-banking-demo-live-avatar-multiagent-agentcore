import { useState } from "react";
import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";

interface CanvasImage {
    url: string;
    prompt: string;
    timestamp: string;
}

interface CanvasHistoryDisplayProps {
    images: CanvasImage[];
}

export default function CanvasHistoryDisplay({ images }: CanvasHistoryDisplayProps) {
    const [selectedImage, setSelectedImage] = useState<CanvasImage | null>(null);

    if (images.length === 0) {
        return (
            <Box variant="p" color="text-body-secondary">
                No images generated yet.
            </Box>
        );
    }

    return (
        <>
            <div className="grid grid-cols-3 gap-2">
                {images.map((image, index) => (
                    <button
                        key={`${image.timestamp}-${index}`}
                        type="button"
                        onClick={() => setSelectedImage(image)}
                        className="cursor-pointer rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors aspect-square"
                    >
                        <img
                            src={image.url}
                            alt={image.prompt}
                            className="w-full h-full object-cover"
                        />
                    </button>
                ))}
            </div>

            <Modal
                visible={selectedImage !== null}
                onDismiss={() => setSelectedImage(null)}
                header="Image Detail"
                size="large"
                footer={
                    <Box float="right">
                        <Button onClick={() => setSelectedImage(null)}>Close</Button>
                    </Box>
                }
            >
                {selectedImage && (
                    <>
                        <div className="flex justify-center">
                            <img
                                src={selectedImage.url}
                                alt={selectedImage.prompt}
                                className="max-w-full max-h-[70vh] object-contain"
                            />
                        </div>
                        <Box variant="p" margin={{ top: "s" }}>
                            {selectedImage.prompt}
                        </Box>
                        <Box variant="p" color="text-body-secondary" fontSize="body-s">
                            {new Date(selectedImage.timestamp).toLocaleString()}
                        </Box>
                    </>
                )}
            </Modal>
        </>
    );
}
