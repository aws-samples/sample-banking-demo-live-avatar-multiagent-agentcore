import {
    createContext,
    useContext,
    useReducer,
    useEffect,
    useRef,
    useCallback,
    PropsWithChildren,
} from "react";
import type { AgentId, ResearchPhase } from "@/lib/agentcore-client/types";
import { ResearchDispatchContext } from "./useResearchOptional";

export interface ThinkingTrace {
    agent: AgentId;
    content: string;
    timestamp: Date;
}

interface ResearchState {
    activeAgent: AgentId | null;
    completedPhases: ResearchPhase[];
    phaseProgress: Record<ResearchPhase, number>;
    thinkingTraces: ThinkingTrace[];
    isActive: boolean;
}

type ResearchAction =
    | { type: "AGENT_START"; agent: AgentId; phase: ResearchPhase }
    | { type: "AGENT_END"; agent: AgentId; phase: ResearchPhase }
    | { type: "PHASE_PROGRESS"; phase: ResearchPhase; progress: number }
    | { type: "THINKING"; agent: AgentId; content: string }
    | { type: "RESET" };

const HEARTBEAT_MESSAGES: Partial<Record<AgentId, string[]>> = {
    planner: [
        "Analyzing main research question...",
        "Breaking question down into sub-questions...",
        "Evaluating importance of each sub-question...",
        "Organizing sub-questions for logical flow...",
    ],
    researcher: [
        "Gathering relevant information...",
        "Searching for authoritative sources...",
        "Analyzing data from multiple perspectives...",
        "Evaluating credibility of information...",
        "Documenting findings with citations...",
    ],
    synthesizer: [
        "Identifying key patterns and themes...",
        "Connecting related findings...",
        "Organizing insights into coherent structure...",
        "Evaluating strength of evidence...",
        "Drawing meaningful conclusions...",
        "Generating PDF report...",
    ],
    menu_designer: [
        "Selecting matching products...",
        "Generating product imagery...",
        "Organizing catalog sections...",
        "Compiling catalog layout...",
    ],
    menu_pdf_writer: [
        "Formatting catalog PDF...",
        "Embedding product imagery...",
        "Finalizing layout...",
    ],
};

const initialState: ResearchState = {
    activeAgent: null,
    completedPhases: [],
    phaseProgress: {
        planning: 0,
        research: 0,
        "synthesis & report": 0,
        design: 0,
        export: 0,
    },
    thinkingTraces: [],
    isActive: false,
};

function researchReducer(state: ResearchState, action: ResearchAction): ResearchState {
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
                phaseProgress: {
                    ...state.phaseProgress,
                    [action.phase]: 100,
                },
                isActive: action.phase !== "synthesis & report" && action.phase !== "export",
            };

        case "PHASE_PROGRESS":
            return {
                ...state,
                phaseProgress: {
                    ...state.phaseProgress,
                    [action.phase]: action.progress,
                },
            };

        case "THINKING":
            return {
                ...state,
                thinkingTraces: [
                    ...state.thinkingTraces,
                    { agent: action.agent, content: action.content, timestamp: new Date() },
                ],
            };

        case "RESET":
            return initialState;

        default:
            return state;
    }
}

interface ResearchContextType {
    state: ResearchState;
    dispatch: React.Dispatch<ResearchAction>;
}

const ResearchContext = createContext<ResearchContextType | undefined>(undefined);

export function useResearch(): ResearchContextType {
    const context = useContext(ResearchContext);
    if (context === undefined) {
        throw new Error("useResearch must be used within a ResearchContextProvider");
    }
    return context;
}

export function ResearchContextProvider({ children }: PropsWithChildren): JSX.Element {
    const [state, dispatch] = useReducer(researchReducer, initialState);
    const lastActivityRef = useRef<Record<string, number>>({});
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const wrappedDispatch: React.Dispatch<ResearchAction> = useCallback(
        (action: ResearchAction) => {
            if (action.type === "THINKING" || action.type === "AGENT_START") {
                const agent = "agent" in action ? action.agent : undefined;
                if (agent) lastActivityRef.current[agent] = Date.now();
            }
            dispatch(action);
        },
        []
    );

    useEffect(() => {
        if (!state.isActive || !state.activeAgent) {
            if (heartbeatRef.current) {
                clearInterval(heartbeatRef.current);
                heartbeatRef.current = null;
            }
            return;
        }

        heartbeatRef.current = setInterval(() => {
            const agent = state.activeAgent;
            if (!agent) return;

            const lastActivity = lastActivityRef.current[agent] ?? 0;
            if (Date.now() - lastActivity > 6000) {
                const messages = HEARTBEAT_MESSAGES[agent] ?? ["Still working..."];
                const message = messages[Math.floor(Math.random() * messages.length)];
                dispatch({ type: "THINKING", agent, content: message });
                lastActivityRef.current[agent] = Date.now();
            }
        }, 8000);

        return () => {
            if (heartbeatRef.current) {
                clearInterval(heartbeatRef.current);
                heartbeatRef.current = null;
            }
        };
    }, [state.isActive, state.activeAgent]);

    return (
        <ResearchContext.Provider value={{ state, dispatch: wrappedDispatch }}>
            <ResearchDispatchContext.Provider value={wrappedDispatch}>
                {children}
            </ResearchDispatchContext.Provider>
        </ResearchContext.Provider>
    );
}
