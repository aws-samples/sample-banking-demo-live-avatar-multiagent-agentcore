import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "research-store";

interface ResearchStoreEntry {
    text: string;
    title: string;
    savedAt: string;
}

interface UseResearchStoreReturn {
    save: (text: string, title: string) => void;
    load: () => ResearchStoreEntry | null;
    clear: () => void;
    data: ResearchStoreEntry | null;
}

function readFromStorage(): ResearchStoreEntry | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as ResearchStoreEntry;
    } catch {
        return null;
    }
}

export function useResearchStore(): UseResearchStoreReturn {
    const [data, setData] = useState<ResearchStoreEntry | null>(null);

    useEffect(() => {
        setData(readFromStorage());
    }, []);

    const save = useCallback((text: string, title: string): void => {
        const entry: ResearchStoreEntry = {
            text,
            title,
            savedAt: new Date().toISOString(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
        setData(entry);
    }, []);

    const load = useCallback((): ResearchStoreEntry | null => {
        return readFromStorage();
    }, []);

    const clear = useCallback((): void => {
        localStorage.removeItem(STORAGE_KEY);
        setData(null);
    }, []);

    return { save, load, clear, data };
}
