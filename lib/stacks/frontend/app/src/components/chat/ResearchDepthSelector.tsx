import Select from "@cloudscape-design/components/select";
import { useChatStore, RESEARCH_DEPTH_CONFIGS, type ResearchDepth } from "@/stores/chatStore";

const OPTIONS = (
    Object.entries(RESEARCH_DEPTH_CONFIGS) as [
        ResearchDepth,
        (typeof RESEARCH_DEPTH_CONFIGS)[ResearchDepth],
    ][]
).map(([value, cfg]) => ({
    value,
    label: cfg.label,
    description: cfg.description,
}));

export function ResearchDepthSelector(): JSX.Element {
    const depth = useChatStore((s) => s.researchDepth);
    const setDepth = useChatStore((s) => s.setResearchDepth);

    return (
        <Select
            selectedOption={OPTIONS.find((o) => o.value === depth) ?? OPTIONS[1]}
            onChange={({ detail }) => setDepth(detail.selectedOption.value as ResearchDepth)}
            options={OPTIONS}
            triggerVariant="option"
        />
    );
}
