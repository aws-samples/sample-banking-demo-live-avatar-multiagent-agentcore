import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    type PropsWithChildren,
} from "react";
import { createElement } from "react";
import { applyMode, Mode } from "@cloudscape-design/global-styles";

type ThemeMode = "light" | "dark";

interface ThemeContextType {
    mode: ThemeMode;
    toggleMode: () => void;
}

const STORAGE_KEY = "theme-mode";

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function apply(mode: ThemeMode): void {
    applyMode(mode === "dark" ? Mode.Dark : Mode.Light);
}

export function ThemeProvider({ children }: PropsWithChildren): JSX.Element {
    const [mode, setMode] = useState<ThemeMode>(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored === "dark" ? "dark" : "light";
    });

    useEffect(() => {
        apply(mode);
    }, [mode]);

    const toggleMode = useCallback(() => {
        setMode((prev) => {
            const next = prev === "light" ? "dark" : "light";
            localStorage.setItem(STORAGE_KEY, next);
            return next;
        });
    }, []);

    return createElement(ThemeContext.Provider, { value: { mode, toggleMode } }, children);
}

export function useTheme(): ThemeContextType {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
}
