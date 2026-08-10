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
} from "lucide-react";
import { useFeedbackSummary } from "@/hooks/useFeedbackSummary";
import type {
    FeedbackSummary,
    FeedbackEvent,
    FeedbackInsight,
} from "@/services/feedbackSummaryService";

/**
 * Continuous Feedback Loop — the AI Assistant's live quality readout.
 *
 * Every thumbs rating, human edit and applied A/B winner captured during
 * catalog review is aggregated here and shown as a turning loop:
 *   Generate → Collect → Evaluate → Improve
 * mirroring the AgentCore Evaluations lifecycle (experimentation → online
 * sampling → post-production insights). The thumbs the operator already uses
 * are the loop's input, not a separate mechanism.
 */

const STAGES = [
    { key: "generate", label: "Generate", icon: Sparkles, color: "#ff9900" },
    { key: "collect", label: "Collect", icon: Inbox, color: "#4fd1a5" },
    { key: "evaluate", label: "Evaluate", icon: Gauge, color: "#8b8ef7" },
    { key: "improve", label: "Improve", icon: RefreshCw, color: "#e0b850" },
] as const;

function bandColor(rate: number): string {
    if (rate >= 0.85) return "#37b24d";
    if (rate >= 0.7) return "#e0b850";
    return "#f03e3e";
}

export default function ContinuousFeedbackLoop(): JSX.Element | null {
    const { summary, loading } = useFeedbackSummary();

    // Render nothing until the first read resolves — the rail already carries
    // the pipeline view, and a flash of empty scaffolding on load is noise.
    if (!summary && loading) return null;
    if (!summary) return null;

    const active = summary.totals.total > 0;

    return (
        <div
            className="rounded-lg p-3"
            style={{ border: "1px solid var(--glass-border)", background: "var(--glass-bg)" }}
        >
            <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <TrendingUp size={14} /> Continuous Feedback Loop
                </span>
                <span
                    className="flex items-center gap-1 text-[10px]"
                    style={{ color: "var(--app-text-secondary)" }}
                >
                    <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: active ? "#37b24d" : "var(--app-text-secondary)" }}
                    />
                    {active ? "Live" : "Idle"}
                </span>
            </div>

            <LoopRing summary={summary} active={active} />

            {active ? (
                <>
                    <StatRow summary={summary} />
                    {summary.trend.length > 1 && <TrendSparkline summary={summary} />}
                    <SourceBars summary={summary} />
                    <InsightList insights={summary.insights} />
                    <RecentList recent={summary.recent} />
                </>
            ) : (
                <p
                    className="mt-2 text-center text-xs leading-relaxed"
                    style={{ color: "var(--app-text-secondary)" }}
                >
                    The loop is idle. Rate, edit or A/B a service in the catalog review to see it
                    turn.
                </p>
            )}
        </div>
    );
}

function LoopRing({ summary, active }: { summary: FeedbackSummary; active: boolean }): JSX.Element {
    const rate = summary.totals.approvalRate;
    const ring = active ? bandColor(rate) : "var(--app-text-secondary)";

    return (
        <div className="relative mx-auto my-1 h-[188px] w-[188px]">
            {/* Flowing ring + traveling pulse behind the stage badges */}
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
                <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="var(--glass-border)"
                    strokeWidth="1.5"
                />
                {active && (
                    <motion.circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke={ring}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeDasharray="3 5"
                        animate={{ strokeDashoffset: [0, -16] }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                        opacity={0.7}
                    />
                )}
                {active && (
                    <motion.g
                        style={{ originX: "50px", originY: "50px" }}
                        animate={{ rotate: 360 }}
                        transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                    >
                        <circle cx="50" cy="10" r="2.6" fill={ring} />
                    </motion.g>
                )}
            </svg>

            {/* Center: overall approval */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-semibold" style={{ color: ring }}>
                    {active ? `${Math.round(rate * 100)}%` : "—"}
                </span>
                <span className="text-[10px]" style={{ color: "var(--app-text-secondary)" }}>
                    approval
                </span>
            </div>

            {/* Stage badges pinned N/E/S/W */}
            {STAGES.map((stage, i) => {
                const Icon = stage.icon;
                const pos = [
                    "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2",
                    "right-0 top-1/2 translate-x-1/2 -translate-y-1/2",
                    "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2",
                    "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2",
                ][i];
                const isCollect = stage.key === "collect";
                return (
                    <div key={stage.key} className={`absolute ${pos} flex flex-col items-center`}>
                        <motion.div
                            className="flex h-8 w-8 items-center justify-center rounded-full"
                            style={{
                                background: "var(--app-bg, #0b0f1a)",
                                border: `1.5px solid ${active ? stage.color : "var(--glass-border)"}`,
                                color: active ? stage.color : "var(--app-text-secondary)",
                            }}
                            animate={
                                active && isCollect
                                    ? {
                                          boxShadow: [
                                              `0 0 0 0 ${stage.color}55`,
                                              `0 0 0 6px transparent`,
                                          ],
                                      }
                                    : undefined
                            }
                            transition={
                                active && isCollect
                                    ? { duration: 1.6, repeat: Infinity, ease: "easeOut" }
                                    : undefined
                            }
                        >
                            <Icon size={15} />
                        </motion.div>
                        <span
                            className="mt-0.5 text-[9px] font-medium"
                            style={{ color: "var(--app-text-secondary)" }}
                        >
                            {stage.label}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

function StatRow({ summary }: { summary: FeedbackSummary }): JSX.Element {
    const { totals, topModel } = summary;
    const stats = [
        { label: "Signals", value: String(totals.total) },
        { label: "Edit rate", value: `${Math.round(totals.editRate * 100)}%` },
        {
            label: "Top A/B model",
            value: topModel ? shortModel(topModel.model) : "—",
        },
    ];
    return (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
            {stats.map((s) => (
                <div
                    key={s.label}
                    className="rounded-md px-1.5 py-1 text-center"
                    style={{ border: "1px solid var(--glass-border)" }}
                >
                    <div className="truncate text-xs font-semibold" title={s.value}>
                        {s.value}
                    </div>
                    <div className="text-[9px]" style={{ color: "var(--app-text-secondary)" }}>
                        {s.label}
                    </div>
                </div>
            ))}
        </div>
    );
}

function TrendSparkline({ summary }: { summary: FeedbackSummary }): JSX.Element {
    const points = summary.trend;
    const max = Math.max(1, ...points.map((p) => p.positive + p.negative));
    const barW = 100 / points.length;

    return (
        <div className="mt-3">
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
            <svg viewBox="0 0 100 28" className="h-8 w-full" preserveAspectRatio="none">
                {points.map((p, i) => {
                    const posH = (p.positive / max) * 26;
                    const negH = (p.negative / max) * 26;
                    const x = i * barW + barW * 0.15;
                    const w = barW * 0.7;
                    return (
                        <g key={p.date}>
                            <rect
                                x={x}
                                y={28 - negH}
                                width={w}
                                height={negH}
                                fill="#f03e3e"
                                opacity={0.8}
                                rx={0.6}
                            />
                            <rect
                                x={x}
                                y={28 - negH - posH}
                                width={w}
                                height={posH}
                                fill="#37b24d"
                                opacity={0.9}
                                rx={0.6}
                            />
                        </g>
                    );
                })}
            </svg>
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
    };
    return (
        <div className="mt-3">
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
                            {iconFor[s.source] ?? <ThumbsDown size={11} />}
                            <span className="truncate">{s.label}</span>
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
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
        <div className="mt-3 flex flex-col gap-1.5">
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
        <div className="mt-3">
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
