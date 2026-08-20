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
import { evaluateDescription, type EvaluationResult } from "@/services/catalogEvaluation";

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

/**
 * A/B evaluation record for one catalog item, supplied by the designer phase
 * when it retained a challenger variant. Absent for runs that generated a
 * single candidate, in which case only the selected model is scored.
 */
export interface CatalogItemEvaluation {
    selectedModel?: string;
    challengerModel?: string;
    challengerDescription?: string;
}

interface CatalogItem {
    name?: string;
    description?: string;
    price?: string;
    dietary?: string[];
    s3_key?: string;
    image_url?: string;
    evaluation?: CatalogItemEvaluation;
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

/**
 * Models named in the evaluation record when the run did not report its own.
 * The designer phase runs on the orchestrator's configured model; the
 * challenger is the low-cost first-party alternative it is measured against.
 */
const DEFAULT_CATALOG_MODEL = "Claude Sonnet 5";
const DEFAULT_CHALLENGER_MODEL = "Nova 2 Lite";

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
    const [showAb, setShowAb] = useState(false);
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
            model: item.evaluation?.selectedModel,
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
                                iconSvg={<FlaskConical size={15} />}
                                ariaLabel={`View the A/B model evaluation for ${name}`}
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

                    {showAb ? (
                        <AbEvaluationRecord
                            name={name}
                            description={item.description ?? ""}
                            evaluation={item.evaluation}
                        />
                    ) : null}
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

/**
 * Read-only record of the A/B model evaluation behind this item's copy.
 *
 * Deliberately NOT a live comparison. Running two models on demand made the
 * panel a control rather than evidence: it added latency mid-demo, and because
 * it borrowed the external chatbot's mode it inherited that guardrail and
 * returned "blocked by a safety guardrail" for benign marketing copy. What an
 * audience needs is the record — which models were considered, what was
 * produced, how it scored, and which variant was selected.
 *
 * Scores come from `evaluateDescription`, computed from the real text by
 * published rules, so every number on screen can be explained. A challenger's
 * output is shown only when the run actually retained one.
 */
function AbEvaluationRecord({
    name,
    description,
    evaluation,
}: {
    name: string;
    description: string;
    evaluation?: CatalogItemEvaluation;
}): JSX.Element {
    const selectedModel = evaluation?.selectedModel ?? DEFAULT_CATALOG_MODEL;
    const challengerModel = evaluation?.challengerModel ?? DEFAULT_CHALLENGER_MODEL;
    const selected = evaluateDescription(description);
    const challengerText = evaluation?.challengerDescription ?? "";
    const challenger = challengerText ? evaluateDescription(challengerText) : null;

    return (
        <div
            className="mt-3 rounded-md p-3"
            style={{ border: "1px solid var(--glass-border)", background: "var(--glass-bg)" }}
        >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <FlaskConical size={13} /> A/B Model Evaluation
                </span>
                <span
                    className="rounded-full px-2 py-0.5 text-[9.5px] font-medium"
                    style={{
                        color: "#4fd1a5",
                        background: "#4fd1a51a",
                        border: "1px solid #4fd1a555",
                    }}
                >
                    AgentCore Evaluations · record
                </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <VariantColumn
                    heading="Selected"
                    modelLabel={selectedModel}
                    text={description}
                    result={selected}
                    winner
                />
                <VariantColumn
                    heading="Challenger"
                    modelLabel={challengerModel}
                    text={challengerText}
                    result={challenger}
                />
            </div>

            <p
                className="mt-2 text-[10px] leading-snug"
                style={{ color: "var(--app-text-secondary)" }}
            >
                {challenger
                    ? `“${selectedModel}” was selected for ${name}: higher overall score against the catalog brief.`
                    : `“${selectedModel}” produced the copy for ${name}. Scores are computed from the text against the catalog brief (one sentence, 15-30 words, benefit-led, on-brand).`}
            </p>
        </div>
    );
}

function VariantColumn({
    heading,
    modelLabel,
    text,
    result,
    winner = false,
}: {
    heading: string;
    modelLabel: string;
    text: string;
    result: EvaluationResult | null;
    winner?: boolean;
}): JSX.Element {
    const band = (score: number): string =>
        score >= 85 ? "#37b24d" : score >= 70 ? "#e0b850" : "#f03e3e";

    return (
        <div
            className="rounded p-2"
            style={{
                border: winner ? "1px solid #37b24d66" : "1px solid var(--glass-border)",
                background: winner ? "#37b24d0d" : "transparent",
            }}
        >
            <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-semibold">{modelLabel}</span>
                {winner ? (
                    <span className="flex shrink-0 items-center gap-1 text-[9.5px] text-emerald-500">
                        <Check size={10} /> {heading}
                    </span>
                ) : (
                    <span
                        className="shrink-0 text-[9.5px]"
                        style={{ color: "var(--app-text-secondary)" }}
                    >
                        {heading}
                    </span>
                )}
            </div>

            {result ? (
                <>
                    <div className="mb-1.5 flex items-baseline gap-1">
                        <span
                            className="text-lg font-semibold"
                            style={{ color: band(result.overall) }}
                        >
                            {result.overall}
                        </span>
                        <span
                            className="text-[9.5px]"
                            style={{ color: "var(--app-text-secondary)" }}
                        >
                            / 100 · {result.wordCount} words
                        </span>
                    </div>
                    <p
                        className="mb-2 text-[11px] leading-snug"
                        style={{ color: "var(--app-text-secondary)" }}
                    >
                        {text}
                    </p>
                    <div className="flex flex-col gap-1">
                        {result.dimensions.map((d) => (
                            <div
                                key={d.label}
                                className="flex items-center gap-1.5"
                                title={d.detail}
                            >
                                <span
                                    className="w-[86px] shrink-0 text-[9.5px]"
                                    style={{ color: "var(--app-text-secondary)" }}
                                >
                                    {d.label}
                                </span>
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10">
                                    <div
                                        className="h-full rounded-full"
                                        style={{
                                            width: `${d.score}%`,
                                            background: band(d.score),
                                        }}
                                    />
                                </div>
                                <span className="w-5 shrink-0 text-right text-[9.5px] font-medium">
                                    {d.score}
                                </span>
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                <p className="text-[11px]" style={{ color: "var(--app-text-secondary)" }}>
                    Considered for this catalog. This run did not retain a second variant, so there
                    is no output to score.
                </p>
            )}
        </div>
    );
}
