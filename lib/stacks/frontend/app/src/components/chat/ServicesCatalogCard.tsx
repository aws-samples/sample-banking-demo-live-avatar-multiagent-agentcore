import { useMemo, useState } from "react";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import Spinner from "@cloudscape-design/components/spinner";
import { Volume2, Square, Pencil, FlaskConical, ThumbsUp, ThumbsDown, Check } from "lucide-react";
import { useAuth } from "react-oidc-context";
import { useChatStore } from "@/stores/chatStore";
import { useSpeech } from "@/hooks/useSpeech";
import { AVAILABLE_MODELS } from "@/hooks/useModelSelector";
import { submitFeedback, type FeedbackMetadata } from "@/services/feedbackService";
import {
    compareModels,
    buildDescriptionPrompt,
    type AbCompareResult,
} from "@/services/abCompareService";

/**
 * Human-in-the-loop review of the generated services catalog, rendered INLINE
 * IN THE CHAT.
 *
 * The pipeline stops after the design phase and waits here. Review controls
 * belong in the conversation — beside the message that produced the catalog —
 * rather than in a passive side panel, because they are a step in the flow:
 * read an item aloud, edit its wording, A/B a description against another
 * model, rate it, then approve. Nothing is exported until the user says so.
 */

interface CatalogItem {
    name?: string;
    description?: string;
    price?: string;
    dietary?: string[];
    s3_key?: string;
    image_url?: string;
    [key: string]: unknown;
}

interface CatalogSection {
    name?: string;
    items?: CatalogItem[];
}

interface ServicesCatalogCardProps {
    title?: string;
    sections?: CatalogSection[];
    onAction?: (action: string, data: unknown) => void;
}

const MODEL_OPTIONS: SelectProps.Option[] = AVAILABLE_MODELS.map((m) => ({
    label: m.label,
    value: m.value,
    description: m.description,
}));

export function ServicesCatalogCard({
    title,
    sections = [],
    onAction,
}: ServicesCatalogCardProps): JSX.Element {
    const auth = useAuth();
    const speech = useSpeech();
    const sessionId = useChatStore((s) => s.slots["menu"]?.sessionId ?? "");

    // Local working copy: edits and applied A/B winners live here until the
    // user approves, so nothing half-reviewed can leak into the export.
    const [draft, setDraft] = useState<CatalogSection[]>(() =>
        sections.map((section) => ({
            ...section,
            items: (section.items ?? []).map((item) => ({ ...item })),
        }))
    );
    const [approved, setApproved] = useState(false);

    const allItems = useMemo(() => draft.flatMap((s) => s.items ?? []), [draft]);
    const itemCount = allItems.length;

    const updateItem = (sectionIdx: number, itemIdx: number, patch: Partial<CatalogItem>): void => {
        setDraft((prev) =>
            prev.map((section, si) =>
                si !== sectionIdx
                    ? section
                    : {
                          ...section,
                          items: (section.items ?? []).map((item, ii) =>
                              ii === itemIdx ? { ...item, ...patch } : item
                          ),
                      }
            )
        );
    };

    /**
     * Spoken walkthrough of the catalog.
     *
     * Framed as a progress summary (count, then each service with its headline
     * rate) rather than a flat description dump, because the requirement is
     * speech output that lets a customer track their accounts and investments —
     * the rate is the part they are tracking.
     */
    const readAll = (): void => {
        if (speech.speaking && speech.activeId === "all") {
            speech.stop();
            return;
        }
        if (allItems.length === 0) return;
        const lead = `Here are the ${allItems.length} services in your Trinity Reserve catalog.`;
        const body = allItems
            .map((it) => `${it.name}${it.price ? `, ${it.price}` : ""}. ${it.description ?? ""}`)
            .join(" ");
        speech.speak(`${lead} ${body}`.trim(), "all");
    };

    const handleApprove = (): void => {
        setApproved(true);
        onAction?.("menu_export", { catalog: { title, sections: draft } });
    };

    return (
        <div className="my-3">
            <Container
                header={
                    <Header
                        variant="h2"
                        description={
                            approved
                                ? "Approved — exporting the catalog."
                                : `Review ${itemCount} generated ${itemCount === 1 ? "service" : "services"}. Nothing is exported until you approve.`
                        }
                        actions={
                            speech.supported && !approved ? (
                                <Button onClick={readAll}>
                                    {speech.speaking && speech.activeId === "all"
                                        ? "Stop"
                                        : "Read all aloud"}
                                </Button>
                            ) : undefined
                        }
                    >
                        {title || "Services Catalog"}
                    </Header>
                }
            >
                <SpaceBetween size="l">
                    {draft.map((section, sectionIdx) => (
                        <div key={section.name ?? sectionIdx}>
                            <Box variant="h4" margin={{ bottom: "xs" }}>
                                {section.name ?? `Section ${sectionIdx + 1}`}
                            </Box>
                            <SpaceBetween size="s">
                                {(section.items ?? []).map((item, itemIdx) => (
                                    <ReviewRow
                                        key={`${sectionIdx}-${itemIdx}`}
                                        item={item}
                                        rowId={`${sectionIdx}-${itemIdx}`}
                                        readOnly={approved}
                                        speech={speech}
                                        sessionId={sessionId}
                                        idToken={auth.user?.id_token}
                                        accessToken={auth.user?.access_token}
                                        onChange={(patch) => updateItem(sectionIdx, itemIdx, patch)}
                                    />
                                ))}
                            </SpaceBetween>
                        </div>
                    ))}

                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            {approved ? (
                                <StatusIndicator type="loading">Exporting catalog…</StatusIndicator>
                            ) : (
                                <>
                                    <Button onClick={() => onAction?.("start_over", {})}>
                                        Start Over
                                    </Button>
                                    <Button variant="primary" onClick={handleApprove}>
                                        Approve &amp; Export
                                    </Button>
                                </>
                            )}
                        </SpaceBetween>
                    </Box>
                </SpaceBetween>
            </Container>
        </div>
    );
}

interface ReviewRowProps {
    item: CatalogItem;
    rowId: string;
    readOnly: boolean;
    speech: ReturnType<typeof useSpeech>;
    sessionId: string;
    idToken?: string;
    accessToken?: string;
    onChange: (patch: Partial<CatalogItem>) => void;
}

function ReviewRow({
    item,
    rowId,
    readOnly,
    speech,
    sessionId,
    idToken,
    accessToken,
    onChange,
}: ReviewRowProps): JSX.Element {
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState(item.description ?? "");
    const [showAb, setShowAb] = useState(false);
    const [abRunning, setAbRunning] = useState(false);
    const [abResult, setAbResult] = useState<AbCompareResult | null>(null);
    const [abError, setAbError] = useState<string | null>(null);
    const [modelA, setModelA] = useState<SelectProps.Option>(MODEL_OPTIONS[0]);
    const [modelB, setModelB] = useState<SelectProps.Option>(
        MODEL_OPTIONS[MODEL_OPTIONS.length - 1]
    );
    const [rated, setRated] = useState<"positive" | "negative" | null>(null);
    const [edited, setEdited] = useState(false);

    const name = item.name ?? "Service";
    const speakingThis = speech.speaking && speech.activeId === rowId;

    const sendFeedback = (
        feedbackType: "positive" | "negative",
        comment: string,
        metadata?: FeedbackMetadata
    ): void => {
        setRated(feedbackType);
        if (!idToken) return;
        void submitFeedback(
            {
                sessionId,
                message: `${name}: ${item.description ?? ""}`,
                feedbackType,
                comment,
                metadata: { itemName: name, experience: "menu", ...metadata },
            },
            idToken
        ).catch(() => undefined);
    };

    const runAb = async (): Promise<void> => {
        if (!accessToken) {
            setAbError("Sign in required to run A/B testing.");
            return;
        }
        setAbRunning(true);
        setAbError(null);
        setAbResult(null);
        try {
            setAbResult(
                await compareModels({
                    prompt: buildDescriptionPrompt(name),
                    modelA: String(modelA.value),
                    modelB: String(modelB.value),
                    accessToken,
                })
            );
        } catch (err) {
            setAbError(err instanceof Error ? err.message : "A/B comparison failed");
        } finally {
            setAbRunning(false);
        }
    };

    const applyText = (next: string, note: string, metadata?: FeedbackMetadata): void => {
        onChange({ description: next });
        setText(next);
        setEdited(true);
        sendFeedback("positive", note, metadata);
    };

    return (
        <div
            className="rounded-md p-3"
            style={{ border: "1px solid var(--glass-border)", background: "var(--glass-bg)" }}
        >
            <div className="flex items-start gap-3">
                {item.image_url ? (
                    <img
                        src={item.image_url}
                        alt={name}
                        className="h-14 w-14 flex-none rounded object-cover"
                        loading="lazy"
                    />
                ) : null}

                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                            {name}
                            {edited && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-[1px] text-[9.5px] text-emerald-300">
                                    <Check size={9} /> edited
                                </span>
                            )}
                        </span>
                        {item.price ? (
                            <span
                                className="shrink-0 text-xs font-medium"
                                style={{ color: "var(--app-text-secondary)" }}
                            >
                                {item.price}
                            </span>
                        ) : null}
                    </div>

                    {editing ? (
                        <div className="mt-2">
                            <Textarea
                                value={text}
                                onChange={({ detail }) => setText(detail.value)}
                                rows={3}
                                ariaLabel={`Edit description for ${name}`}
                            />
                            <div className="mt-2 flex gap-2">
                                <Button
                                    variant="primary"
                                    onClick={() => {
                                        applyText(text.trim(), "Human-in-the-loop edit saved", {
                                            source: "edit",
                                        });
                                        setEditing(false);
                                    }}
                                >
                                    Save
                                </Button>
                                <Button
                                    variant="link"
                                    onClick={() => {
                                        setText(item.description ?? "");
                                        setEditing(false);
                                    }}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <p
                            className="mt-1 text-xs leading-relaxed"
                            style={{ color: "var(--app-text-secondary)" }}
                        >
                            {item.description}
                        </p>
                    )}

                    {!readOnly && (
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                            {speech.supported && (
                                <Button
                                    variant="inline-icon"
                                    iconSvg={
                                        speakingThis ? <Square size={15} /> : <Volume2 size={15} />
                                    }
                                    ariaLabel={speakingThis ? "Stop reading" : `Read ${name} aloud`}
                                    onClick={() =>
                                        speakingThis
                                            ? speech.stop()
                                            : speech.speak(
                                                  `${name}. ${item.description ?? ""}`,
                                                  rowId
                                              )
                                    }
                                />
                            )}
                            <Button
                                variant="inline-icon"
                                iconSvg={<Pencil size={15} />}
                                ariaLabel={`Edit ${name} description`}
                                onClick={() => {
                                    setText(item.description ?? "");
                                    setEditing(true);
                                }}
                            />
                            <Button
                                variant="inline-icon"
                                iconSvg={<FlaskConical size={15} />}
                                ariaLabel={`A/B test ${name} description`}
                                onClick={() => setShowAb((v) => !v)}
                            />
                            <Button
                                variant="inline-icon"
                                iconSvg={
                                    <ThumbsUp
                                        size={15}
                                        color={rated === "positive" ? "#37b24d" : undefined}
                                    />
                                }
                                ariaLabel={`Rate ${name} helpful`}
                                onClick={() =>
                                    sendFeedback("positive", "Catalog item rated helpful", {
                                        source: "catalog_rating",
                                    })
                                }
                            />
                            <Button
                                variant="inline-icon"
                                iconSvg={
                                    <ThumbsDown
                                        size={15}
                                        color={rated === "negative" ? "#f03e3e" : undefined}
                                    />
                                }
                                ariaLabel={`Rate ${name} not helpful`}
                                onClick={() =>
                                    sendFeedback("negative", "Catalog item rated not helpful", {
                                        source: "catalog_rating",
                                    })
                                }
                            />
                        </div>
                    )}

                    {showAb && !readOnly ? (
                        <div
                            className="mt-3 rounded p-2"
                            style={{ border: "1px solid var(--glass-border)" }}
                        >
                            <div className="mb-2 flex items-end gap-2">
                                <div className="flex-1">
                                    <Box variant="awsui-key-label">Model A</Box>
                                    <Select
                                        selectedOption={modelA}
                                        onChange={({ detail }) => setModelA(detail.selectedOption)}
                                        options={MODEL_OPTIONS}
                                    />
                                </div>
                                <div className="flex-1">
                                    <Box variant="awsui-key-label">Model B</Box>
                                    <Select
                                        selectedOption={modelB}
                                        onChange={({ detail }) => setModelB(detail.selectedOption)}
                                        options={MODEL_OPTIONS}
                                    />
                                </div>
                                <Button
                                    variant="primary"
                                    loading={abRunning}
                                    onClick={() => void runAb()}
                                >
                                    Run
                                </Button>
                            </div>

                            {abRunning ? (
                                <Box textAlign="center" padding="s">
                                    <Spinner /> Generating both variants…
                                </Box>
                            ) : null}
                            {abError ? (
                                <StatusIndicator type="error">{abError}</StatusIndicator>
                            ) : null}
                            {abResult ? (
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <AbVariant
                                        label="A"
                                        modelLabel={modelA.label ?? ""}
                                        text={abResult.a.text}
                                        elapsedMs={abResult.a.elapsedMs}
                                        error={abResult.a.error}
                                        onUse={() =>
                                            applyText(abResult.a.text, "A/B winner applied (A)", {
                                                source: "ab_test",
                                                model: String(modelA.label ?? modelA.value),
                                            })
                                        }
                                    />
                                    <AbVariant
                                        label="B"
                                        modelLabel={modelB.label ?? ""}
                                        text={abResult.b.text}
                                        elapsedMs={abResult.b.elapsedMs}
                                        error={abResult.b.error}
                                        onUse={() =>
                                            applyText(abResult.b.text, "A/B winner applied (B)", {
                                                source: "ab_test",
                                                model: String(modelB.label ?? modelB.value),
                                            })
                                        }
                                    />
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

interface AbVariantProps {
    label: string;
    modelLabel: string;
    text: string;
    elapsedMs: number;
    error?: string;
    onUse: () => void;
}

function AbVariant({
    label,
    modelLabel,
    text,
    elapsedMs,
    error,
    onUse,
}: AbVariantProps): JSX.Element {
    return (
        <div className="rounded p-2" style={{ border: "1px solid var(--glass-border)" }}>
            <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold">
                    {label} · {modelLabel}
                </span>
                <span className="text-[10px]" style={{ color: "var(--app-text-secondary)" }}>
                    {(elapsedMs / 1000).toFixed(1)}s
                </span>
            </div>
            {error ? (
                <StatusIndicator type="error">{error}</StatusIndicator>
            ) : (
                <p className="text-xs" style={{ color: "var(--app-text-secondary)" }}>
                    {text || "(no output)"}
                </p>
            )}
            <div className="mt-1">
                <Button variant="link" disabled={!text} onClick={onUse}>
                    Use this
                </Button>
            </div>
        </div>
    );
}
