import { useState } from "react";
import { Sparkles, Check, MessageSquareText, Wand2, Info } from "lucide-react";

/**
 * Feedback-driven prompt optimization card for the AI Assistant.
 *
 * Rendered from the backend `PromptImprovement` generative-UI event (the
 * `menu_optimize` mode). It closes the continuous feedback loop: reviewer
 * thumbs, comments, and edits are read back, and a prompt-engineer model
 * proposes concrete copy-guidance refinements for the catalog designer. The
 * presenter reviews them here and clicks Apply — human-in-the-loop — so the
 * NEXT catalog run adopts them. Nothing changes the live prompt until Apply.
 */

interface PromptImprovementProps {
    status?: "ready" | "insufficient" | "error";
    summaryOfFeedback?: string;
    rationale?: string;
    refinements?: string[];
    feedbackSummary?: string;
    signalCount?: number;
    /** Injected by the message renderer; fires the apply/optimize actions. */
    onAction?: (action: string, data: unknown) => void;
}

export function PromptImprovementCard({
    status = "ready",
    summaryOfFeedback = "",
    rationale = "",
    refinements = [],
    signalCount = 0,
    onAction,
}: PromptImprovementProps): JSX.Element {
    const [applied, setApplied] = useState(false);

    if (status === "insufficient") {
        return (
            <div className="my-2 rounded-lg border border-slate-700 bg-slate-900/70 p-4">
                <div className="mb-1 flex items-center gap-2">
                    <Info className="h-4 w-4 text-slate-400" aria-hidden />
                    <h3 className="text-sm font-semibold text-slate-100">
                        Prompt Optimization from Feedback
                    </h3>
                </div>
                <p className="text-xs text-slate-400">
                    Not enough feedback yet to propose a refinement. Rate a few catalog items
                    (thumbs up/down with a comment) or edit some descriptions, then run this again.
                </p>
            </div>
        );
    }

    if (status === "error") {
        return (
            <div className="my-2 rounded-lg border border-slate-700 bg-slate-900/70 p-4">
                <div className="mb-1 flex items-center gap-2">
                    <Info className="h-4 w-4 text-amber-400" aria-hidden />
                    <h3 className="text-sm font-semibold text-slate-100">
                        Prompt Optimization from Feedback
                    </h3>
                </div>
                <p className="text-xs text-slate-400">
                    Couldn&apos;t generate a refinement this time. Try again in a moment.
                </p>
            </div>
        );
    }

    const handleApply = (): void => {
        setApplied(true);
        onAction?.("apply_prompt_improvement", { refinements, signalCount });
    };

    return (
        <div className="my-2 rounded-lg border border-slate-700 bg-slate-900/70 p-4">
            <div className="mb-3 flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-indigo-300" aria-hidden />
                <h3 className="text-sm font-semibold text-slate-100">
                    Prompt Optimization from Feedback
                </h3>
                <span className="ml-auto rounded-full border border-indigo-400/40 bg-indigo-500/10 px-2 py-0.5 text-[9.5px] font-medium text-indigo-300">
                    {signalCount} signal{signalCount === 1 ? "" : "s"}
                </span>
            </div>

            {summaryOfFeedback && (
                <div className="mb-3 flex items-start gap-2 rounded-md border border-slate-800 bg-slate-950/40 p-2.5">
                    <MessageSquareText
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400"
                        aria-hidden
                    />
                    <div>
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">
                            What reviewers reacted to
                        </div>
                        <p className="mt-0.5 text-xs text-slate-300">{summaryOfFeedback}</p>
                    </div>
                </div>
            )}

            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Proposed refinements to the designer prompt
            </div>
            <ul className="mb-3 space-y-1.5">
                {refinements.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-slate-200">
                        <Sparkles
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-300"
                            aria-hidden
                        />
                        <span>{r}</span>
                    </li>
                ))}
            </ul>

            {rationale && (
                <p className="mb-3 text-[11px] italic leading-snug text-slate-400">{rationale}</p>
            )}

            <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500">
                    {applied
                        ? "Applied — the next catalog run will use these refinements."
                        : "Review, then apply to the next catalog run. The live prompt is unchanged until you do."}
                </span>
                <button
                    onClick={handleApply}
                    disabled={applied}
                    className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                        applied
                            ? "cursor-default border border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                            : "border border-indigo-400/50 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25"
                    }`}
                >
                    {applied ? (
                        <>
                            <Check className="h-3.5 w-3.5" /> Applied
                        </>
                    ) : (
                        <>
                            <Wand2 className="h-3.5 w-3.5" /> Apply to next catalog
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
