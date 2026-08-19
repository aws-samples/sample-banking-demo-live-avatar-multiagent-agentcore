import { motion } from "framer-motion";
import {
    Sparkles,
    Inbox,
    Gauge,
    RefreshCw,
    ThumbsUp,
    ThumbsDown,
    Pencil,
    FlaskConical,
    TrendingUp,
    AlertTriangle,
    Info,
    CheckCircle2,
    ChevronRight,
} from "lucide-react";
import { useFeedbackSummary } from "@/hooks/useFeedbackSummary";
import { useChatStore } from "@/stores/chatStore";
import type {
    FeedbackSummary,
    FeedbackEvent,
    FeedbackInsight,
} from "@/services/feedbackSummaryService";

/**
 * Continuous Feedback Loop — the AI Assistant's live quality readout.
 *
 * Laid out as a left-to-right flywheel with a return arrow, matching the agent
 * workflow diagrams elsewhere in the app. An earlier version drew this as a
 * circle with the four stages pinned N/E/S/W; in a panel this shape it cost a
 * lot of vertical space and the badge labels collided with the metrics beneath
 * it, so the picture actively got in the way of the numbers.
 *
 * Every figure is real: ratings, human edits and applied A/B winners captured
 * during catalog review, aggregated by GET /feedback/summary. Rates are
 * qualified while the sample is small rather than presented as if settled.
 */

/** Below this many signals a percentage is noise, and is labelled as such. */
const SMALL_SAMPLE = 5;

function bandColor(rate: number): string {
    if (rate >= 0.85) return "#37b24d";
    if (rate >= 0.7) return "#e0b850";
    return "#f03e3e";
}

export default function ContinuousFeedbackLoop(): JSX.Element | null {
    const { summary, loading } = useFeedbackSummary();
    // Items currently in the catalog — the "Generate" stage's real output.
    const generatedCount = useChatStore((s) =>
        s.menuState.sections.reduce((n, section) => n + section.items.length, 0)
    );

    // Render nothing until the first read resolves — the rail already carries
    // the pipeline view, and a flash of empty scaffolding on load is noise.
    if (!summary && loading) return null;
    if (!summary) return null;

    const { totals, bySource } = summary;
    const active = totals.total > 0;
    // "Improve" counts the signals that changed something downstream: human
    // edits, applied A/B winners, and feedback-driven designer prompt updates.
    const improvements =
        (bySource.find((s) => s.source === "edit")?.count ?? 0) +
        (bySource.find((s) => s.source === "ab_test")?.count ?? 0) +
        (bySource.find((s) => s.source === "prompt_update")?.count ?? 0);
    const smallSample = totals.total > 0 && totals.total < SMALL_SAMPLE;

    const stages = [
        {
            key: "generate",
            label: "Generate",
            icon: Sparkles,
            color: "#ff9900",
            value: generatedCount > 0 ? String(generatedCount) : "—",
            unit: generatedCount === 1 ? "item" : "items",
        },
        {
            key: "collect",
            label: "Collect",
            icon: Inbox,
            color: "#4fd1a5",
            value: String(totals.total),
            unit: totals.total === 1 ? "signal" : "signals",
        },
        {
            key: "evaluate",
            label: "Evaluate",
            icon: Gauge,
            color: "#8b8ef7",
            value: active ? `${Math.round(totals.approvalRate * 100)}%` : "—",
            unit: "approved",
        },
        {
            key: "improve",
            label: "Improve",
            icon: RefreshCw,
            color: "#e0b850",
            value: String(improvements),
            unit: improvements === 1 ? "applied" : "applied",
        },
    ] as const;

    return (
        <div
            className="rounded-lg p-3"
            style={{ border: "1px solid var(--glass-border)", background: "var(--glass-bg)" }}
        >
            <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <TrendingUp size={14} /> Continuous Feedback Loop
                </span>
                <span
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wider"
                    style={{ color: "var(--app-text-secondary)" }}
                >
                    <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: active ? "#37b24d" : "var(--app-text-secondary)" }}
                    />
                    {active ? "Live" : "Idle"}
                </span>
            </div>

            {/* Flywheel: four stages left to right, then a return arrow showing
                the loop closing back on the next catalog. */}
            <div className="flex items-stretch gap-1">
                {stages.map((stage, i) => (
                    <div key={stage.key} className="flex min-w-0 flex-1 items-center gap-1">
                        <div
                            className="min-w-0 flex-1 rounded-md px-1.5 py-2 text-center"
                            style={{
                                border: `1px solid ${active ? `${stage.color}55` : "var(--glass-border)"}`,
                                background: active ? `${stage.color}0f` : "transparent",
                            }}
                        >
                            <motion.div
                                className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full"
                                style={{
                                    color: active ? stage.color : "var(--app-text-secondary)",
                                    background: active ? `${stage.color}1f` : "transparent",
                                }}
                                animate={active ? { opacity: [1, 0.45, 1] } : undefined}
                                transition={
                                    active
                                        ? {
                                              duration: 2.4,
                                              repeat: Infinity,
                                              ease: "easeInOut",
                                              delay: i * 0.6,
                                          }
                                        : undefined
                                }
                            >
                                <stage.icon size={13} />
                            </motion.div>
                            <div className="truncate text-[13px] font-semibold leading-none">
                                {stage.value}
                            </div>
                            <div
                                className="mt-0.5 truncate text-[9px]"
                                style={{ color: "var(--app-text-secondary)" }}
                            >
                                {stage.unit}
                            </div>
                            <div
                                className="mt-1 truncate text-[9.5px] font-medium"
                                style={{
                                    color: active ? stage.color : "var(--app-text-secondary)",
                                }}
                            >
                                {stage.label}
                            </div>
                        </div>
                        {i < stages.length - 1 && (
                            <ChevronRight
                                size={12}
                                className="shrink-0"
                                style={{ color: "var(--app-text-secondary)" }}
                                aria-hidden
                            />
                        )}
                    </div>
                ))}
            </div>

            {/* Return path — what makes it a loop rather than a funnel. */}
            <div className="mt-1 flex items-center gap-1.5">
                <svg
                    viewBox="0 0 100 10"
                    preserveAspectRatio="none"
                    className="h-2.5 flex-1"
                    aria-hidden
                >
                    <path
                        d="M98 1 L98 6 Q98 9 95 9 L5 9 Q2 9 2 6 L2 1"
                        fill="none"
                        stroke={active ? "#e0b850" : "var(--glass-border)"}
                        strokeWidth="1"
                        strokeDasharray={active ? "3 3" : undefined}
                        opacity={active ? 0.9 : 0.5}
                    />
                </svg>
            </div>
            <div
                className="mb-3 text-center text-[9.5px]"
                style={{ color: "var(--app-text-secondary)" }}
            >
                Findings inform the next catalog
            </div>

            {active ? (
                <>
                    {smallSample && (
                        <div
                            className="mb-2 rounded-md px-2 py-1.5 text-[10px] leading-snug"
                            style={{
                                border: "1px solid #e0b85044",
                                background: "#e0b85011",
                            }}
                        >
                            Early sample — {totals.total} signal
                            {totals.total === 1 ? "" : "s"} so far. Rates will settle as more
                            reviews come in.
                        </div>
                    )}
                    <ApprovalBar summary={summary} smallSample={smallSample} />
                    <TrendStrip summary={summary} />
                    <SourceBars summary={summary} />
                    <InsightList insights={summary.insights} />
                    <RecentList recent={summary.recent} />
                </>
            ) : (
                <p
                    className="text-center text-xs leading-relaxed"
                    style={{ color: "var(--app-text-secondary)" }}
                >
                    The loop is idle. Rate, edit or review a service in the catalog to see it turn.
                </p>
            )}
        </div>
    );
}

/**
 * Approval as a split bar. Reads faster than a lone percentage because the
 * negative share is visible rather than inferred.
 */
function ApprovalBar({
    summary,
    smallSample,
}: {
    summary: FeedbackSummary;
    smallSample: boolean;
}): JSX.Element {
    const { positive, negative, total, approvalRate } = summary.totals;
    const pct = Math.round(approvalRate * 100);
    return (
        <div className="mb-3">
            <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[10px]" style={{ color: "var(--app-text-secondary)" }}>
                    Approval
                </span>
                <span
                    className="text-sm font-semibold"
                    style={{ color: smallSample ? "var(--app-text)" : bandColor(approvalRate) }}
                >
                    {pct}%
                </span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-black/10">
                <div style={{ width: `${pct}%`, background: "#37b24d" }} />
                <div style={{ width: `${100 - pct}%`, background: "#f03e3e" }} />
            </div>
            <div
                className="mt-1 flex justify-between text-[9.5px]"
                style={{ color: "var(--app-text-secondary)" }}
            >
                <span>{positive} helpful</span>
                <span>
                    {negative} not helpful · {total} total
                </span>
            </div>
        </div>
    );
}

/**
 * Sentiment over time.
 *
 * Sparse data is drawn as discrete pills rather than stretched bars — one day of
 * activity previously filled the whole width with a single green slab that
 * looked like a rendering fault.
 */
function TrendStrip({ summary }: { summary: FeedbackSummary }): JSX.Element | null {
    const points = summary.trend;
    if (points.length === 0) return null;

    const max = Math.max(1, ...points.map((p) => p.positive + p.negative));

    return (
        <div className="mb-3">
            <div
                className="mb-1 flex items-center justify-between text-[10px]"
                style={{ color: "var(--app-text-secondary)" }}
            >
                <span>Sentiment over time</span>
                <span className="flex items-center gap-2">
                    <span className="flex items-center gap-1">
                        <span className="inline-block h-1.5 w-1.5 rounded-sm bg-[#37b24d]" /> up
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="inline-block h-1.5 w-1.5 rounded-sm bg-[#f03e3e]" /> down
                    </span>
                </span>
            </div>
            <div className="flex h-12 items-end gap-1">
                {points.map((p) => {
                    const totalDay = p.positive + p.negative;
                    const h = totalDay === 0 ? 2 : Math.max(6, (totalDay / max) * 44);
                    const posShare = totalDay === 0 ? 0 : p.positive / totalDay;
                    return (
                        <div
                            key={p.date}
                            className="flex max-w-[26px] flex-1 flex-col justify-end"
                            title={`${p.date}: ${p.positive} up, ${p.negative} down`}
                        >
                            <div
                                className="flex w-full flex-col overflow-hidden rounded-sm"
                                style={{ height: h }}
                            >
                                <div
                                    style={{
                                        height: `${posShare * 100}%`,
                                        background: "#37b24d",
                                    }}
                                />
                                <div
                                    style={{
                                        height: `${(1 - posShare) * 100}%`,
                                        background:
                                            totalDay === 0 ? "var(--glass-border)" : "#f03e3e",
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function SourceBars({ summary }: { summary: FeedbackSummary }): JSX.Element | null {
    const sources = summary.bySource;
    if (sources.length === 0) return null;
    const max = Math.max(1, ...sources.map((s) => s.count));
    const iconFor: Record<string, JSX.Element> = {
        catalog_rating: <ThumbsUp size={11} />,
        chat_rating: <ThumbsUp size={11} />,
        edit: <Pencil size={11} />,
        ab_test: <FlaskConical size={11} />,
        prompt_update: <RefreshCw size={11} />,
    };
    return (
        <div className="mb-3">
            <div className="mb-1 text-[10px]" style={{ color: "var(--app-text-secondary)" }}>
                Signal mix
            </div>
            <div className="flex flex-col gap-1">
                {sources.map((s) => (
                    <div key={s.source} className="flex items-center gap-1.5">
                        <span
                            className="flex w-24 shrink-0 items-center gap-1 text-[10px]"
                            style={{ color: "var(--app-text-secondary)" }}
                        >
                            {iconFor[s.source] ?? <Info size={11} />}
                            {/* Signals recorded before sources were tagged arrive
                                as "other"; name that honestly. */}
                            <span className="truncate">
                                {s.source === "other" ? "Untagged" : s.label}
                            </span>
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10">
                            <div
                                className="h-full rounded-full"
                                style={{
                                    width: `${(s.count / max) * 100}%`,
                                    background: "linear-gradient(90deg,#4fd1a5,#8b8ef7)",
                                }}
                            />
                        </div>
                        <span className="w-4 text-right text-[10px] font-medium">{s.count}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function InsightList({ insights }: { insights: FeedbackInsight[] }): JSX.Element | null {
    if (insights.length === 0) return null;
    const meta = {
        positive: { icon: CheckCircle2, color: "#37b24d" },
        warning: { icon: AlertTriangle, color: "#e0b850" },
        neutral: { icon: Info, color: "#8b8ef7" },
    };
    return (
        <div className="mb-3 flex flex-col gap-1.5">
            <div className="text-[10px]" style={{ color: "var(--app-text-secondary)" }}>
                Recommendations
            </div>
            {insights.map((ins, i) => {
                const m = meta[ins.tone];
                const Icon = m.icon;
                return (
                    <div
                        key={i}
                        className="flex items-start gap-1.5 rounded-md p-1.5"
                        style={{ border: `1px solid ${m.color}44`, background: `${m.color}11` }}
                    >
                        <Icon size={12} color={m.color} className="mt-[1px] shrink-0" />
                        <span className="text-[10.5px] leading-snug">{ins.text}</span>
                    </div>
                );
            })}
        </div>
    );
}

function RecentList({ recent }: { recent: FeedbackEvent[] }): JSX.Element | null {
    if (recent.length === 0) return null;
    return (
        <div>
            <div className="mb-1 text-[10px]" style={{ color: "var(--app-text-secondary)" }}>
                Recent signals
            </div>
            <div className="flex flex-col gap-1">
                {recent.slice(0, 6).map((e, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10.5px]">
                        {e.feedbackType === "positive" ? (
                            <ThumbsUp size={11} color="#37b24d" className="shrink-0" />
                        ) : (
                            <ThumbsDown size={11} color="#f03e3e" className="shrink-0" />
                        )}
                        <span className="min-w-0 flex-1 truncate">
                            {e.itemName || sourceLabel(e.source)}
                            {e.model ? (
                                <span style={{ color: "var(--app-text-secondary)" }}>
                                    {" "}
                                    · {shortModel(e.model)}
                                </span>
                            ) : null}
                        </span>
                        <span
                            className="shrink-0 text-[9px]"
                            style={{ color: "var(--app-text-secondary)" }}
                        >
                            {shortTime(e.createdAt)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function sourceLabel(source: string): string {
    return (
        {
            catalog_rating: "Catalog rating",
            chat_rating: "Chat rating",
            edit: "Human edit",
            ab_test: "A/B winner",
            prompt_update: "Prompt update",
            other: "Untagged signal",
        }[source] ?? source
    );
}

function shortModel(model: string): string {
    // Trim provider prefixes and version suffixes for a compact chip.
    const tail = model.split(/[/.]/).pop() ?? model;
    return tail.replace(/-v\d+.*$/i, "").slice(0, 16);
}

function shortTime(iso: string): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
