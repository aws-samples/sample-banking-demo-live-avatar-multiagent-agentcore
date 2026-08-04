import { useAvatarKbPipelinesStore } from "@/stores/avatarKbPipelinesStore";
import type { KbPipeline } from "@/lib/websocket-client/client";
import { Library } from "lucide-react";

interface ChipDef {
    id: KbPipeline;
    label: string;
    hint: string;
}

const CHIPS: readonly ChipDef[] = [
    {
        id: "strategy_research",
        label: "Market Strategy",
        hint: "Market Strategy reports",
    },
    {
        id: "market_research",
        label: "Market Intelligence",
        hint: "Market Intelligence / Research Studio reports",
    },
    {
        id: "services",
        label: "Services",
        hint: "Services Catalog documents",
    },
];

interface KbPipelineChipsProps {
    /** Fired whenever the selection changes (incl. the All toggle). */
    onChange?: (pipelines: KbPipeline[]) => void;
    /** Whether the control is disabled (e.g., during disconnected state). */
    disabled?: boolean;
}

/**
 * Chip multi-select for the Voice Avatar KB pipeline scope.
 *
 * "All" is a convenience: toggling it selects every chip (backend treats empty
 * and full selection the same — "search every view"). The store persists the
 * selection across page reloads via localStorage.
 */
export default function KbPipelineChips({
    onChange,
    disabled = false,
}: KbPipelineChipsProps): JSX.Element {
    const pipelines = useAvatarKbPipelinesStore((s) => s.pipelines);
    const togglePipeline = useAvatarKbPipelinesStore((s) => s.togglePipeline);
    const selectAll = useAvatarKbPipelinesStore((s) => s.selectAll);
    const clearSelection = useAvatarKbPipelinesStore((s) => s.clearSelection);
    const isAllSelected = useAvatarKbPipelinesStore((s) => s.isAllSelected());

    const handleAllClick = (): void => {
        if (disabled) return;
        if (isAllSelected && pipelines.length > 0) {
            clearSelection();
            onChange?.([]);
            return;
        }
        selectAll();
        onChange?.(["strategy_research", "market_research", "services"]);
    };

    const handleChipClick = (chipId: KbPipeline): void => {
        if (disabled) return;
        togglePipeline(chipId);
        const next = pipelines.includes(chipId)
            ? pipelines.filter((p) => p !== chipId)
            : [...pipelines, chipId];
        onChange?.(next);
    };

    return (
        <div className="flex items-center gap-2 flex-wrap" aria-label="Knowledge base scope">
            <span
                className="inline-flex items-center gap-1 text-xs uppercase tracking-wide"
                style={{ color: "var(--app-text-secondary)" }}
            >
                <Library size={14} />
                KB scope
            </span>
            <button
                type="button"
                role="switch"
                aria-checked={isAllSelected}
                aria-label="All pipelines"
                disabled={disabled}
                onClick={handleAllClick}
                className="text-xs px-2.5 py-1 rounded-full transition-colors"
                style={{
                    background: isAllSelected ? "rgba(255,153,0,0.18)" : "var(--glass-bg)",
                    border: "1px solid var(--glass-border)",
                    color: isAllSelected ? "#FF9900" : "var(--app-text-secondary)",
                    opacity: disabled ? 0.5 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                }}
            >
                All
            </button>
            {CHIPS.map(({ id, label, hint }) => {
                const selected = pipelines.includes(id);
                return (
                    <button
                        key={id}
                        type="button"
                        role="switch"
                        aria-checked={selected}
                        aria-label={hint}
                        title={hint}
                        disabled={disabled}
                        onClick={() => handleChipClick(id)}
                        className="text-xs px-2.5 py-1 rounded-full transition-colors"
                        style={{
                            background: selected ? "rgba(255,153,0,0.18)" : "var(--glass-bg)",
                            border: "1px solid var(--glass-border)",
                            color: selected ? "#FF9900" : "var(--app-text-secondary)",
                            opacity: disabled ? 0.5 : 1,
                            cursor: disabled ? "not-allowed" : "pointer",
                        }}
                    >
                        {label}
                    </button>
                );
            })}
        </div>
    );
}
