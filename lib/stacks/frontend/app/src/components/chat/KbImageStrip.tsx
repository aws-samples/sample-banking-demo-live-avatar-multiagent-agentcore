import { useState } from "react";
import Modal from "@cloudscape-design/components/modal";
import { Image as ImageIcon } from "lucide-react";
import type { ToolRenderProps } from "@/hooks/useToolRenderer";
import { extractKbImages, kbImageAltText, type KbImage } from "@/components/common/flow/kbImages";

/**
 * Inline thumbnails for the images a multimodal `kb_search` call retrieved.
 *
 * Rendered alongside the KB source documents in the AI Agent chat. It parses
 * the tool result defensively (via {@link extractKbImages}) and no-ops when the
 * `images` array is empty or missing — the common case when multimodal
 * retrieval is off — so it can be registered unconditionally for `kb_search`.
 * Each thumbnail opens a lightbox, mirroring the affordance the avatar chat and
 * generated-image cards already use.
 */
export function KbImageStrip({ name, status, result }: ToolRenderProps): JSX.Element | null {
    const [lightbox, setLightbox] = useState<KbImage | null>(null);

    if (status !== "complete") return null;
    const images = extractKbImages(name, result);
    if (images.length === 0) return null;

    return (
        <div className="my-2">
            <div
                className="mb-1.5 flex items-center gap-1.5 text-xs"
                style={{ color: "var(--app-text-secondary)" }}
            >
                <ImageIcon size={12} style={{ color: "var(--app-accent)" }} aria-hidden="true" />
                <span>Retrieved from Knowledge Base</span>
            </div>
            <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                {images.map((image, i) => (
                    <li key={`${image.imageUrl}-${i}`}>
                        <button
                            type="button"
                            onClick={() => setLightbox(image)}
                            className="block cursor-pointer rounded-lg overflow-hidden p-0"
                            style={{
                                border: "1px solid var(--app-border)",
                                background: "var(--app-surface)",
                            }}
                            aria-label={`Enlarge ${kbImageAltText(image)}`}
                        >
                            <img
                                src={image.imageUrl}
                                alt={kbImageAltText(image)}
                                loading="lazy"
                                style={{
                                    width: 120,
                                    height: 120,
                                    objectFit: "cover",
                                    display: "block",
                                }}
                            />
                        </button>
                    </li>
                ))}
            </ul>

            <Modal
                visible={!!lightbox}
                onDismiss={() => setLightbox(null)}
                header="Retrieved from Knowledge Base"
                size="large"
            >
                {lightbox && (
                    <figure className="m-0">
                        <img
                            src={lightbox.imageUrl}
                            alt={kbImageAltText(lightbox)}
                            style={{ width: "100%", height: "auto", borderRadius: 8 }}
                        />
                        {(lightbox.source || lightbox.page) && (
                            <figcaption
                                className="mt-2 text-xs"
                                style={{ color: "var(--app-text-secondary)" }}
                            >
                                {lightbox.source}
                                {lightbox.page ? ` · page ${lightbox.page}` : ""}
                            </figcaption>
                        )}
                    </figure>
                )}
            </Modal>
        </div>
    );
}
