import { useContext, createContext } from "react";
import type { AgentId, ResearchPhase } from "@/lib/agentcore-client/types";

type ResearchAction =
    | { type: "AGENT_START"; agent: AgentId; phase: ResearchPhase }
    | { type: "AGENT_END"; agent: AgentId; phase: ResearchPhase }
    | { type: "PHASE_PROGRESS"; phase: ResearchPhase; progress: number }
    | { type: "THINKING"; agent: AgentId; content: string }
    | { type: "RESET" };

// Shared context for optional access — set by ResearchContextProvider
export const ResearchDispatchContext = createContext<React.Dispatch<ResearchAction> | null>(null);

/**
 * Get the research dispatch function, or null if not inside a ResearchContextProvider.
 * Unlike useResearch(), this does NOT throw when used outside the provider.
 */
export function useResearchOptional(): React.Dispatch<ResearchAction> | null {
    return useContext(ResearchDispatchContext);
}
