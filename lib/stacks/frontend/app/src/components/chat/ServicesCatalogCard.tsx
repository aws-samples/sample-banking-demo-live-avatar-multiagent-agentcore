import { useMemo, useState } from "react";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Modal from "@cloudscape-design/components/modal";
import { Volume2, Square, Pencil, FlaskConical, ThumbsUp, ThumbsDown, Check } from "lucide-react";
import { useAuth } from "react-oidc-context";
import { useChatStore } from "@/stores/chatStore";
import { useSpeech } from "@/hooks/useSpeech";
import { submitFeedback, type FeedbackMetadata } from "@/services/feedbackService";

/**
 * Human-in-the-loop review of the generated services catalog, rendered INLINE
 * IN THE CHAT.
 *
 * The pipeline stops after the design phase and waits here. Review controls
 * belong in the conversation — beside the message that produced the catalog —
 * rather than in a passive side panel, because they are a step in the flow:
 * read an item aloud, edit its wording, rate it, then approve. Nothing is
 * exported until the user says so.
 *
 * Model validation is a real, managed step: "Launch Bedrock evaluation" ships
 * the copy to Amazon Bedrock's model-evaluation service as two model-as-a-judge
 * jobs (base vs challenger), whose scorecards live in the Bedrock console.
 */

/** Whether the managed Bedrock evaluation button is enabled for this build. */
const MANAGED_EVAL_ENABLED = import.meta.env.VITE_BEDROCK_MANAGED_EVAL_ENABLED === "true";

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

export function ServicesCatalogCard({
    title,
    sections = [],
    onAction,
}: ServicesCatalogCardProps): JSX.Element {
    const auth = useAuth();
    const speech = useSpeech();
    const sessionId = useChatStore((s) => s.slots["menu"]?.sessionId ?? "");
    const [evalLaunched, setEvalLaunched] = useState(false);

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

    /**
     * Kick off the real, managed A/B: ship the current copy to Amazon Bedrock's
     * model-evaluation service as two model-as-a-judge jobs. Async — the card
     * that streams back is the launch receipt; scorecards live in the console.
     */
    const handleLaunchEval = (): void => {
        setEvalLaunched(true);
        onAction?.("catalog_evaluate", { catalog: { title, sections: draft } });
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
                                    {/* Continuous feedback loop: turn the ratings,
                                        comments and edits gathered here into
                                        designer-prompt refinements for the next run. */}
                                    <Button
                                        iconName="gen-ai"
                                        onClick={() => onAction?.("optimize_from_feedback", {})}
                                    >
                                        Improve prompt from feedback
                                    </Button>
                                    {MANAGED_EVAL_ENABLED && (
                                        <Button
                                            iconSvg={<FlaskConical size={15} />}
                                            disabled={evalLaunched}
                                            onClick={handleLaunchEval}
                                        >
                                            {evalLaunched
                                                ? "Evaluation launched"
                                                : "Launch Bedrock evaluation"}
                                        </Button>
                                    )}
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
    onChange: (patch: Partial<CatalogItem>) => void;
}

function ReviewRow({
    item,
    rowId,
    readOnly,
    speech,
    sessionId,
    idToken,
    onChange,
}: ReviewRowProps): JSX.Element {
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState(item.description ?? "");
    const [rated, setRated] = useState<"positive" | "negative" | null>(null);
    const [edited, setEdited] = useState(false);

    // Vote popup: opened when a thumb is clicked so the reviewer can attach a
    // comment and reason tags. That commentary is what feeds the continuous
    // feedback loop's prompt optimization — a bare thumb carries no "why".
    const [voteOpen, setVoteOpen] = useState(false);
    const [voteSentiment, setVoteSentiment] = useState<"positive" | "negative">("positive");
    const [voteComment, setVoteComment] = useState("");
    const [voteReasons, setVoteReasons] = useState<string[]>([]);

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

    // Reason chips offered in the vote popup, tuned per sentiment so the tags
    // map cleanly onto prompt guidance (too long/off-brand → refinements).
    const REASONS: Record<"positive" | "negative", string[]> = {
        positive: ["Great tone", "Clear", "On-brand", "Benefit-led", "Right length"],
        negative: [
            "Too long",
            "Too short",
            "Off-brand",
            "Not benefit-led",
            "Inaccurate",
            "Generic",
        ],
    };

    const openVote = (sentiment: "positive" | "negative"): void => {
        setVoteSentiment(sentiment);
        setVoteComment("");
        setVoteReasons([]);
        setVoteOpen(true);
    };

    const toggleReason = (reason: string): void => {
        setVoteReasons((prev) =>
            prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]
        );
    };

    const submitVote = (withDetail: boolean): void => {
        const comment = withDetail
            ? voteComment.trim() ||
              (voteReasons.length ? voteReasons.join(", ") : `Catalog item rated ${voteSentiment}`)
            : `Catalog item rated ${voteSentiment}`;
        sendFeedback(voteSentiment, comment, {
            source: "catalog_rating",
            reasons: withDetail ? voteReasons : undefined,
            text: item.description ?? "",
        });
        setVoteOpen(false);
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
                        // If a URL still fails (e.g. a re-signed link that has
                        // since expired on a much later revisit), hide the
                        // element rather than showing a broken-image icon.
                        onError={(e) => {
                            e.currentTarget.style.display = "none";
                        }}
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
                                iconSvg={
                                    <ThumbsUp
                                        size={15}
                                        color={rated === "positive" ? "#37b24d" : undefined}
                                    />
                                }
                                ariaLabel={`Rate ${name} helpful`}
                                onClick={() => openVote("positive")}
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
                                onClick={() => openVote("negative")}
                            />
                        </div>
                    )}
                </div>
            </div>

            <Modal
                visible={voteOpen}
                onDismiss={() => setVoteOpen(false)}
                header={
                    voteSentiment === "positive"
                        ? `What worked about “${name}”?`
                        : `What would you change about “${name}”?`
                }
                footer={
                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button variant="link" onClick={() => submitVote(false)}>
                                Skip
                            </Button>
                            <Button variant="primary" onClick={() => submitVote(true)}>
                                Submit feedback
                            </Button>
                        </SpaceBetween>
                    </Box>
                }
            >
                <SpaceBetween size="m">
                    <div className="flex flex-wrap gap-1.5">
                        {REASONS[voteSentiment].map((reason) => {
                            const on = voteReasons.includes(reason);
                            return (
                                <button
                                    key={reason}
                                    type="button"
                                    onClick={() => toggleReason(reason)}
                                    className="rounded-full px-2.5 py-1 text-xs font-medium transition"
                                    style={{
                                        border: on
                                            ? "1px solid #8b8ef7"
                                            : "1px solid var(--glass-border)",
                                        background: on ? "#8b8ef71f" : "transparent",
                                        color: on ? "#c7c9ff" : "var(--app-text-secondary)",
                                    }}
                                    aria-pressed={on}
                                >
                                    {reason}
                                </button>
                            );
                        })}
                    </div>
                    <Textarea
                        value={voteComment}
                        onChange={({ detail }) => setVoteComment(detail.value)}
                        rows={3}
                        placeholder="Optional: add a comment. This feeds the prompt-optimization loop."
                        ariaLabel={`Comment on ${name}`}
                    />
                    <Box variant="small" color="text-body-secondary">
                        Your rating, tags and comment feed the continuous feedback loop that refines
                        the designer prompt.
                    </Box>
                </SpaceBetween>
            </Modal>
        </div>
    );
}
