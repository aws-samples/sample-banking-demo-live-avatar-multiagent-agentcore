import { useChatStore, type ResearchSlot } from "@/stores/chatStore";

const EMPTY: ResearchSlot = {
    activeAgent: null,
    completedPhases: [],
    phaseProgress: {
        planning: 0,
        research: 0,
        "synthesis & report": 0,
        evaluation: 0,
        design: 0,
        "quality control": 0,
        "a/b evaluation": 0,
        review: 0,
        export: 0,
    },
    thinkingTraces: [],
    toolsByAgent: {},
    isActive: false,
};

/**
 * Read research pipeline state for a given mode from the Zustand store.
 * Drop-in replacement for useResearch().state in components that accept a mode prop.
 */
export function useResearchState(mode: string): ResearchSlot {
    return useChatStore((s) => s.researchSlots[mode] ?? EMPTY);
}
