import { useState } from "react";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { ImageIcon } from "lucide-react";

interface CanvasResult {
    success?: boolean;
    image_url?: string;
    image_id?: string;
    s3_key?: string;
    prompt?: string;
    error?: string;
}

interface CanvasResultCardProps {
    result: string;
    onAddToMenu?: (imageUrl: string) => void;
}

export function CanvasResultCard({ result, onAddToMenu }: CanvasResultCardProps): JSX.Element {
    const [added, setAdded] = useState(false);

    let parsed: CanvasResult = {};
    try {
        parsed = JSON.parse(result);
    } catch {
        return (
            <Container header={<Header variant="h3">Image Generation</Header>}>
                <StatusIndicator type="error">Failed to parse result</StatusIndicator>
            </Container>
        );
    }

    if (!parsed.success || !parsed.image_url) {
        return (
            <Container header={<Header variant="h3">Image Generation</Header>}>
                <StatusIndicator type="error">
                    {parsed.error || "Image generation failed"}
                </StatusIndicator>
            </Container>
        );
    }

    const handleAddToMenu = (): void => {
        if (parsed.image_url && onAddToMenu) {
            onAddToMenu(parsed.image_url);
            setAdded(true);
        }
    };

    return (
        <Container
            header={
                <Header
                    variant="h3"
                    actions={
                        onAddToMenu && !added ? (
                            <Button
                                variant="normal"
                                iconSvg={<ImageIcon size={14} />}
                                onClick={handleAddToMenu}
                            >
                                Add to Menu
                            </Button>
                        ) : added ? (
                            <StatusIndicator type="success">Added</StatusIndicator>
                        ) : undefined
                    }
                >
                    Generated Image
                </Header>
            }
        >
            <SpaceBetween size="s">
                <img
                    src={parsed.image_url}
                    alt={parsed.prompt || "Generated image"}
                    className="w-full max-w-[300px] rounded-lg object-cover"
                    loading="lazy"
                />
                {parsed.prompt && (
                    <Box variant="p" color="text-body-secondary" fontSize="body-s">
                        {parsed.prompt}
                    </Box>
                )}
            </SpaceBetween>
        </Container>
    );
}
