import { create } from "zustand";

interface BrowserLiveViewState {
    liveViewUrl: string | null;
    sessionId: string | null;
    remoteWidth: number;
    remoteHeight: number;
    open: (params: {
        liveViewUrl: string;
        sessionId?: string;
        remoteWidth?: number;
        remoteHeight?: number;
    }) => void;
    close: () => void;
}

export const useBrowserLiveViewStore = create<BrowserLiveViewState>((set) => ({
    liveViewUrl: null,
    sessionId: null,
    remoteWidth: 1280,
    remoteHeight: 800,
    open: ({ liveViewUrl, sessionId, remoteWidth, remoteHeight }) =>
        set({
            liveViewUrl,
            sessionId: sessionId ?? null,
            remoteWidth: remoteWidth ?? 1280,
            remoteHeight: remoteHeight ?? 800,
        }),
    close: () => set({ liveViewUrl: null, sessionId: null }),
}));
