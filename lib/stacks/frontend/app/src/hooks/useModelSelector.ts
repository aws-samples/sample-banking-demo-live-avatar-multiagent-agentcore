import { createContext, useContext, useState, useCallback, type PropsWithChildren } from "react";
import { createElement } from "react";

export interface ModelOption {
    label: string;
    value: string;
    description: string;
}

/**
 * Models offered in the UI selector.
 *
 * Every `value` below was verified invocable via `bedrock-runtime:Converse` in
 * us-east-1 on 4 Aug 2026. Two previously-shipped IDs were rejected with
 * "The provided model identifier is invalid" because they omitted the version
 * suffix — `claude-opus-4-6` (needs `-v1`) and `claude-haiku-4-5-20251001`
 * (needs `-v1:0`). Cross-Region inference profile IDs (`us.` prefix) are used
 * for Anthropic models; plain model IDs for Amazon Nova.
 *
 * Before adding an entry, confirm it with Converse — `ListInferenceProfiles`
 * returning an ID does NOT guarantee InvokeModel accepts it. Also avoid models
 * marked LEGACY: Bedrock refuses them once an account has not used them for 30
 * days, which is how `amazon.nova-canvas-v1:0` became unusable here.
 *
 * Deliberately excluded: `claude-fable-5` (requires a non-default data
 * retention mode) and all LEGACY Nova Premier / Canvas / Reel variants.
 */
export const AVAILABLE_MODELS: ModelOption[] = [
    {
        label: "Claude Sonnet 5",
        value: "us.anthropic.claude-sonnet-5",
        description: "Balanced flagship — default",
    },
    {
        label: "Claude Opus 5",
        value: "us.anthropic.claude-opus-5",
        description: "Most capable · extended reasoning",
    },
    {
        label: "Claude Opus 4.7",
        value: "us.anthropic.claude-opus-4-7",
        description: "High-resolution vision, long-horizon tasks",
    },
    {
        label: "Claude Sonnet 4.6",
        value: "us.anthropic.claude-sonnet-4-6",
        description: "Previous flagship — cost/latency baseline",
    },
    {
        label: "Claude Haiku 4.5",
        value: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        description: "Fastest, lightweight drafting",
    },
    {
        label: "Nova 2 Lite",
        value: "us.amazon.nova-2-lite-v1:0",
        description: "Lowest cost · 1M context · Amazon first-party",
    },
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
