import { create } from "zustand";

interface BrowserLiveViewState {
    liveViewUrl: string | null;
    sessionId: string | null;
    remoteWidth: number;
    remoteHeight: number;
    screenshot: string | null;
    open: (params: {
        liveViewUrl: string;
        sessionId?: string;
        remoteWidth?: number;
        remoteHeight?: number;
    }) => void;
    setScreenshot: (image: string) => void;
    close: () => void;
}

export const useBrowserLiveViewStore = create<BrowserLiveViewState>((set) => ({
    liveViewUrl: null,
    sessionId: null,
    remoteWidth: 1280,
    remoteHeight: 800,
    screenshot: null,
    open: ({ liveViewUrl, sessionId, remoteWidth, remoteHeight }) =>
        set({
            liveViewUrl,
            sessionId: sessionId ?? null,
            remoteWidth: remoteWidth ?? 1280,
            remoteHeight: remoteHeight ?? 800,
        }),
    setScreenshot: (image) => set({ screenshot: image }),
    close: () => set({ liveViewUrl: null, sessionId: null, screenshot: null }),
}));
