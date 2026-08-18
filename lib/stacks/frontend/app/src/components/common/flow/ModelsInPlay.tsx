import { Cpu } from "lucide-react";
import { useModelSelector } from "@/hooks/useModelSelector";
import { useConciergeFlowStore } from "@/stores/conciergeFlowStore";
import { judgeLabel } from "@/components/common/evaluation/EvaluationScorecard";

/**
 * "Models in play" strip for the flow panel.
 *
 * Makes it visually obvious which foundation models the run is actually
 * exercising, and lights each one up while it is active:
 *   - the user-selected reasoning model (drives every turn),
 *   - per-tool models inferred from the tools invoked this run (fixed backend
 *     wiring, so the mapping is accurate without a stream signal),
 *   - the Bedrock judge model — pulsing while evaluation runs, resolved once it
 *     reports.
 *
 * Shared across every experience via the Run Report, so all flows surface it.
 */

/**
 * Tools whose backing model is a fixed backend constant. Kept in sync with
 * gateway/tools/*: web_search → Nova 2 Lite web grounding, image_generate →
 * Stability SD3.5. kb_search is a knowledge-base retrieval (shown as a grounded
 * source, not a model), so it is intentionally absent here.
 */
const TOOL_MODELS: Record<string, { role: string; model: string }> = {
    web_search: { role: "Web grounding", model: "Nova 2 Lite" },
    image_generate: { role: "Imagery", model: "Stability SD3.5" },
};

interface Chip {
    role: string;
    model: string;
    active: boolean;
    pulse?: boolean;
}

function ModelChip({ role, model, active, pulse }: Chip): JSX.Element {
    return (
        <div
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors ${
                active
                    ? "border-violet-500/50 bg-violet-500/10"
                    : "border-slate-800 bg-slate-900/40"
            }`}
            title={`${role}: ${model}`}
        >
            <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    active ? "bg-violet-400" : "bg-slate-600"
                } ${pulse ? "animate-pulse" : ""}`}
            />
            <span className="flex flex-col leading-tight">
                <span className="text-[9px] uppercase tracking-wide text-slate-500">{role}</span>
                <span
                    className={`text-[11px] font-medium ${active ? "text-violet-100" : "text-slate-400"}`}
                >
                    {model}
                </span>
            </span>
        </div>
    );
}

export function ModelsInPlay(): JSX.Element {
    const { currentModel } = useModelSelector();
    const runtimeActive = useConciergeFlowStore((s) => s.runtimeActive);
    const invokedTools = useConciergeFlowStore((s) => s.invokedTools);
    const evaluation = useConciergeFlowStore((s) => s.evaluation);
    const evaluating = useConciergeFlowStore((s) => s.evaluating);

    const chips: Chip[] = [
        { role: "Reasoning", model: currentModel.label, active: runtimeActive },
    ];

    for (const [tool, meta] of Object.entries(TOOL_MODELS)) {
        if (invokedTools.has(tool)) {
            chips.push({ role: meta.role, model: meta.model, active: true });
        }
    }

    if (evaluating) {
        chips.push({ role: "Judge", model: "Evaluating…", active: true, pulse: true });
    } else if (evaluation?.judgeModel) {
        chips.push({ role: "Judge", model: judgeLabel(evaluation.judgeModel), active: true });
    }

    return (
        <div className="border-b border-slate-800 px-4 py-3" aria-label="Models in play">
            <div className="mb-2 flex items-center gap-1.5">
                <Cpu size={13} className="text-slate-400" />
                <h3 className="text-xs font-semibold text-slate-100">Models in play</h3>
                <span className="text-[10px] text-slate-500">· Amazon Bedrock</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {chips.map((c) => (
                    <ModelChip key={`${c.role}-${c.model}`} {...c} />
                ))}
            </div>
        </div>
    );
}
