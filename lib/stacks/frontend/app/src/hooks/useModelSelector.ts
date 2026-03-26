import { createContext, useContext, useState, useCallback, type PropsWithChildren } from "react";
import { createElement } from "react";

export interface ModelOption {
    label: string;
    value: string;
    description: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
    {
        label: "Claude Sonnet 4.6",
        value: "us.anthropic.claude-sonnet-4-6",
        description: "Fast, intelligent",
    },
    {
        label: "Claude Opus 4.6",
        value: "us.anthropic.claude-opus-4-6",
        description: "Most capable",
    },
    {
        label: "Claude Haiku 4.5",
        value: "us.anthropic.claude-haiku-4-5-20251001",
        description: "Fastest, lightweight",
    },
    { label: "Nova 2 Lite", value: "us.amazon.nova-2-lite-v1:0", description: "Low cost, fast" },
];

const DEFAULT_MODEL = AVAILABLE_MODELS[0].value;

interface ModelSelectorContextType {
    modelId: string;
    setModelId: (id: string) => void;
    currentModel: ModelOption;
}

const ModelSelectorContext = createContext<ModelSelectorContextType | undefined>(undefined);

export function ModelSelectorProvider({ children }: PropsWithChildren): JSX.Element {
    const [modelId, setModelIdState] = useState<string>(() => {
        return localStorage.getItem("selected-model") ?? DEFAULT_MODEL;
    });

    const setModelId = useCallback((id: string) => {
        localStorage.setItem("selected-model", id);
        setModelIdState(id);
    }, []);

    const currentModel = AVAILABLE_MODELS.find((m) => m.value === modelId) ?? AVAILABLE_MODELS[0];

    return createElement(
        ModelSelectorContext.Provider,
        { value: { modelId, setModelId, currentModel } },
        children
    );
}

export function useModelSelector(): ModelSelectorContextType {
    const context = useContext(ModelSelectorContext);
    if (context === undefined) {
        throw new Error("useModelSelector must be used within a ModelSelectorProvider");
    }
    return context;
}
