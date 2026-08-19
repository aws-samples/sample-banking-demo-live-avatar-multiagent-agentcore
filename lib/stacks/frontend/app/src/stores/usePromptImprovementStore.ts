import { create } from "zustand";

/**
 * Applied designer-prompt refinement for the AI Assistant's continuous feedback
 * loop.
 *
 * The `menu_optimize` orchestrator mode reads reviewer feedback and proposes
 * copy-guidance refinements. When the presenter clicks "Apply" on the
 * PromptImprovement card, the refinements are stored here (human-in-the-loop),
 * and the next catalog design run appends them to the designer prompt via the
 * `designer_prompt_addendum` payload field — closing the loop. Session-scoped:
 * the applied refinement lives only in this browser session.
 */
interface PromptImprovementState {
    /** Applied refinements rendered as a bulleted addendum, or null when none. */
    addendum: string | null;
    /** True once the presenter has applied a refinement this session. */
    applied: boolean;
    /** How many feedback signals the applied refinement was derived from. */
    signalCount: number;
    /** Apply a proposed refinement so the next catalog run uses it. */
    apply(refinements: string[], signalCount?: number): void;
    /** Drop any applied refinement (e.g. on a fresh chat). */
    clear(): void;
}

export const usePromptImprovementStore = create<PromptImprovementState>((set) => ({
    addendum: null,
    applied: false,
    signalCount: 0,
    apply: (refinements, signalCount = 0) =>
        set({
            addendum: refinements.map((r) => `- ${r}`).join("\n"),
            applied: true,
            signalCount,
        }),
    clear: () => set({ addendum: null, applied: false, signalCount: 0 }),
}));
