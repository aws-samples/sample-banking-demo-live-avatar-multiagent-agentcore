import { create } from "zustand";
import type { Message } from "@/components/chat/types";
import type { AgentId, ResearchPhase } from "@/lib/agentcore-client/types";
import type { MenuSection } from "@/components/menu/MenuContext";

// ---------------------------------------------------------------------------
// Research sub-state (mirrors the old ResearchContext reducer)
// ---------------------------------------------------------------------------

export interface ThinkingTrace {
    agent: AgentId;
    content: string;
    timestamp: Date;
}

/**
 * Tool calls attributed to the agent that made them, as
 * `{ [agentId]: { [toolName]: callCount } }`.
 *
 * Attribution (rather than one flat list) is what lets each node in the flow
 * diagram show the AWS services *that step* exercised, instead of a single
 * undifferentiated tally for the whole run.
 */
export type ToolsByAgent = Record<string, Record<string, number>>;

export interface ResearchSlot {
    activeAgent: AgentId | null;
    completedPhases: ResearchPhase[];
    phaseProgress: Record<ResearchPhase, number>;
    thinkingTraces: ThinkingTrace[];
    toolsByAgent: ToolsByAgent;
    isActive: boolean;
}

export type ResearchAction =
    | { type: "AGENT_START"; agent: AgentId; phase: ResearchPhase }
    | { type: "AGENT_END"; agent: AgentId; phase: ResearchPhase }
    | { type: "PHASE_PROGRESS"; phase: ResearchPhase; progress: number }
    | { type: "THINKING"; agent: AgentId; content: string }
    | { type: "TOOL_CALL"; agent: AgentId; tool: string }
    | { type: "RESET" };

const INITIAL_RESEARCH: ResearchSlot = {
    activeAgent: null,
    completedPhases: [],
    phaseProgress: {
        planning: 0,
        research: 0,
        "synthesis & report": 0,
        evaluation: 0,
        design: 0,
        export: 0,
    },
    thinkingTraces: [],
    toolsByAgent: {},
    isActive: false,
};

// Terminal phases: once one of these ends, the pipeline is considered finished
// and the live sidebar can stop treating the run as active. Evaluation is the
// last research phase (it scores the finished report), so it — not
// "synthesis & report" — closes out a research run.
const TERMINAL_PHASES: ResearchPhase[] = ["evaluation", "export"];

function reduceResearch(state: ResearchSlot, action: ResearchAction): ResearchSlot {
    switch (action.type) {
        case "AGENT_START":
            return {
                ...state,
                activeAgent: action.agent,
                isActive: true,
                phaseProgress: {
                    ...state.phaseProgress,
                    [action.phase]: Math.max(state.phaseProgress[action.phase], 10),
                },
            };
        case "AGENT_END":
            return {
                ...state,
                activeAgent: null,
                completedPhases: state.completedPhases.includes(action.phase)
                    ? state.completedPhases
                    : [...state.completedPhases, action.phase],
                phaseProgress: { ...state.phaseProgress, [action.phase]: 100 },
                isActive: !TERMINAL_PHASES.includes(action.phase),
            };
        case "PHASE_PROGRESS":
            return {
                ...state,
                phaseProgress: { ...state.phaseProgress, [action.phase]: action.progress },
            };
        case "THINKING":
            return {
                ...state,
                thinkingTraces: [
                    ...state.thinkingTraces,
                    { agent: action.agent, content: action.content, timestamp: new Date() },
                ],
            };
        case "TOOL_CALL": {
            const forAgent = state.toolsByAgent[action.agent] ?? {};
            return {
                ...state,
                toolsByAgent: {
                    ...state.toolsByAgent,
                    [action.agent]: {
                        ...forAgent,
                        [action.tool]: (forAgent[action.tool] ?? 0) + 1,
                    },
                },
            };
        }
        case "RESET":
            return { ...INITIAL_RESEARCH, toolsByAgent: {} };
        default:
            return state;
    }
}

// ---------------------------------------------------------------------------
// Chat slot (per-mode)
// ---------------------------------------------------------------------------

export interface ChatSlot {
    messages: Message[];
    sessionId: string;
    isLoading: boolean;
    error: string | null;
}

function freshSlot(): ChatSlot {
    return { messages: [], sessionId: crypto.randomUUID(), isLoading: false, error: null };
}

// ---------------------------------------------------------------------------
// Research depth (varying research length)
// ---------------------------------------------------------------------------

export type ResearchDepth = "quick" | "standard" | "deep";

export interface ResearchDepthConfig {
    label: string;
    subQuestions: string; // e.g. "3-4"
    searchBudget: number;
    description: string;
}

export const RESEARCH_DEPTH_CONFIGS: Record<ResearchDepth, ResearchDepthConfig> = {
    quick: {
        label: "Quick",
        subQuestions: "3-4",
        searchBudget: 15,
        description: "Fast overview, 3-4 sub-questions",
    },
    standard: {
        label: "Standard",
        subQuestions: "5-8",
        searchBudget: 50,
        description: "Balanced depth, 5-8 sub-questions",
    },
    deep: {
        label: "Deep",
        subQuestions: "10-15",
        searchBudget: 100,
        description: "Comprehensive, 10-15 sub-questions",
    },
};

// ---------------------------------------------------------------------------
// Menu sub-state
// ---------------------------------------------------------------------------

export interface MenuSlot {
    sections: MenuSection[];
    isGenerating: boolean;
    pdfUrl: string | null;
}

const INITIAL_MENU: MenuSlot = { sections: [], isGenerating: false, pdfUrl: null };

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ChatStore {
    // Per-mode chat state
    slots: Record<string, ChatSlot>;
    getOrCreateSlot(mode: string): ChatSlot;
    setMessages(mode: string, updater: Message[] | ((prev: Message[]) => Message[])): void;
    setLoading(mode: string, loading: boolean): void;
    setError(mode: string, error: string | null): void;
    clearSlot(mode: string): void;

    // Per-mode research state
    researchSlots: Record<string, ResearchSlot>;
    getResearchSlot(mode: string): ResearchSlot;
    dispatchResearch(mode: string, action: ResearchAction): void;

    // Menu state
    menuState: MenuSlot;
    dispatchMenu(action: { type: string; [key: string]: unknown }): void;

    // Research depth
    researchDepth: ResearchDepth;
    setResearchDepth(depth: ResearchDepth): void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
    // -- Chat slots --
    slots: {},

    getOrCreateSlot(mode: string): ChatSlot {
        const existing = get().slots[mode];
        if (existing) return existing;
        const slot = freshSlot();
        set((s) => ({ slots: { ...s.slots, [mode]: slot } }));
        return slot;
    },

    setMessages(mode: string, updater: Message[] | ((prev: Message[]) => Message[])): void {
        set((s) => {
            const slot = s.slots[mode] ?? freshSlot();
            const newMessages = typeof updater === "function" ? updater(slot.messages) : updater;
            return { slots: { ...s.slots, [mode]: { ...slot, messages: newMessages } } };
        });
    },

    setLoading(mode: string, loading: boolean): void {
        set((s) => {
            const slot = s.slots[mode] ?? freshSlot();
            return { slots: { ...s.slots, [mode]: { ...slot, isLoading: loading } } };
        });
    },

    setError(mode: string, error: string | null): void {
        set((s) => {
            const slot = s.slots[mode] ?? freshSlot();
            return { slots: { ...s.slots, [mode]: { ...slot, error } } };
        });
    },

    clearSlot(mode: string): void {
        set((s) => ({
            slots: { ...s.slots, [mode]: freshSlot() },
            researchSlots: { ...s.researchSlots, [mode]: { ...INITIAL_RESEARCH } },
        }));
    },

    // -- Research slots --
    researchSlots: {},

    getResearchSlot(mode: string): ResearchSlot {
        return get().researchSlots[mode] ?? INITIAL_RESEARCH;
    },

    dispatchResearch(mode: string, action: ResearchAction): void {
        set((s) => {
            const current = s.researchSlots[mode] ?? { ...INITIAL_RESEARCH };
            return {
                researchSlots: { ...s.researchSlots, [mode]: reduceResearch(current, action) },
            };
        });
    },

    // -- Menu --
    menuState: { ...INITIAL_MENU },

    dispatchMenu(action: { type: string; [key: string]: unknown }): void {
        set((s) => {
            const st = s.menuState;
            switch (action.type) {
                case "SET_SECTIONS":
                    return { menuState: { ...st, sections: action.sections as MenuSection[] } };
                case "SET_PDF_URL":
                    return { menuState: { ...st, pdfUrl: (action.url as string) ?? null } };
                case "SET_GENERATING":
                    return { menuState: { ...st, isGenerating: action.isGenerating as boolean } };
                case "UPDATE_ITEM": {
                    // Human-in-the-loop edit: patch a single catalog item by id.
                    const id = action.id as string;
                    const updates = action.updates as Partial<MenuSection["items"][number]>;
                    const sections = st.sections.map((sec) => ({
                        ...sec,
                        items: sec.items.map((item) =>
                            item.id === id ? { ...item, ...updates } : item
                        ),
                    }));
                    return { menuState: { ...st, sections } };
                }
                case "SET_LAST_ITEM_IMAGE": {
                    const sections = [...st.sections].map((sec) => ({
                        ...sec,
                        items: [...sec.items],
                    }));
                    let found = false;
                    for (let si = sections.length - 1; si >= 0 && !found; si--) {
                        for (let ii = sections[si].items.length - 1; ii >= 0 && !found; ii--) {
                            if (!sections[si].items[ii].imageUrl) {
                                sections[si].items[ii] = {
                                    ...sections[si].items[ii],
                                    imageUrl: action.imageUrl as string,
                                };
                                found = true;
                            }
                        }
                    }
                    return found ? { menuState: { ...st, sections } } : {};
                }
                case "RESET":
                    return { menuState: { ...INITIAL_MENU } };
                default:
                    return {};
            }
        });
    },

    // -- Research depth --
    researchDepth: (localStorage.getItem("research-depth") as ResearchDepth) || "standard",

    setResearchDepth(depth: ResearchDepth): void {
        localStorage.setItem("research-depth", depth);
        set({ researchDepth: depth });
    },
}));
