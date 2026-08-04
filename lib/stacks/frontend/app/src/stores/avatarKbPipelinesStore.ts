import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { KbPipeline } from "@/lib/websocket-client/client";
import { ALL_KB_PIPELINES } from "@/lib/websocket-client/client";

export type { KbPipeline } from "@/lib/websocket-client/client";

const LOCALSTORAGE_KEY = "avatar-kb-pipelines-v1";

interface AvatarKbPipelinesState {
    /** Currently selected pipelines. Empty array means "All views". */
    pipelines: KbPipeline[];
    /** Replace the entire selection. */
    setPipelines: (pipelines: KbPipeline[]) => void;
    /** Toggle a single pipeline on/off. */
    togglePipeline: (pipeline: KbPipeline) => void;
    /** Select every pipeline (equivalent to "All"). */
    selectAll: () => void;
    /** Clear the selection (also equivalent to "All" in backend semantics). */
    clearSelection: () => void;
    /** Whether every pipeline is currently selected. */
    isAllSelected: () => boolean;
}

/**
 * Avatar KB pipeline multi-select store.
 *
 * The backend treats empty/unspecified as "search every view", so `pipelines=[]`
 * and `pipelines=[strategy_research, market_research, services]` produce the same search
 * scope. The store preserves whichever one the user chose explicitly so the UI
 * can show the correct chip state.
 */
export const useAvatarKbPipelinesStore = create<AvatarKbPipelinesState>()(
    persist(
        (set, get) => ({
            pipelines: [],
            setPipelines: (pipelines) => set({ pipelines: [...pipelines] }),
            togglePipeline: (pipeline) => {
                const current = get().pipelines;
                const next = current.includes(pipeline)
                    ? current.filter((p) => p !== pipeline)
                    : [...current, pipeline];
                set({ pipelines: next });
            },
            selectAll: () => set({ pipelines: [...ALL_KB_PIPELINES] }),
            clearSelection: () => set({ pipelines: [] }),
            isAllSelected: () => {
                const current = get().pipelines;
                // "All" is true when every pipeline is selected OR none are
                // (both map to the same backend behavior).
                return current.length === 0 || current.length === ALL_KB_PIPELINES.length;
            },
        }),
        {
            name: LOCALSTORAGE_KEY,
            partialize: (state) => ({ pipelines: state.pipelines }),
        }
    )
);
