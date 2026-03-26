import { useState } from "react";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";

interface PdfViewerProps {
    url: string;
    title?: string;
}

export default function PdfViewer({ url, title = "Document" }: PdfViewerProps) {
    const [loading, setLoading] = useState(true);
    const [fullscreen, setFullscreen] = useState(false);

    const iframe = (height: string) => (
        <div style={{ position: "relative", width: "100%", height }}>
            {loading && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "var(--color-background-layout-main, #f2f3f3)",
                    }}
                >
                    <Spinner size="large" />
                </div>
            )}
            <iframe
                src={url}
                title={title}
                style={{ width: "100%", height: "100%", border: "none" }}
                onLoad={() => setLoading(false)}
                loading="lazy"
            />
        </div>
    );

    return (
        <>
            <Container
                header={
                    <Header
                        actions={
                            <SpaceBetween direction="horizontal" size="xs">
                                <Button
                                    iconName="expand"
                                    variant="icon"
                                    onClick={() => setFullscreen(true)}
                                    ariaLabel="Fullscreen"
                                />
                                <Button
                                    iconName="download"
                                    variant="icon"
                                    ariaLabel="Open PDF in new tab"
                                    onClick={() => window.open(url, "_blank", "noopener")}
                                />
                            </SpaceBetween>
                        }
                    >
                        {title}
                    </Header>
                }
            >
                {iframe("600px")}
            </Container>

            <Modal
                visible={fullscreen}
                onDismiss={() => setFullscreen(false)}
                header={title}
                size="max"
            >
                {iframe("80vh")}
            </Modal>
        </>
    );
}
