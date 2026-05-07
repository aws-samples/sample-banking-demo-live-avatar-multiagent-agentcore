/**
 * Suggested starter prompts shown in the Voice Avatar transcript before any
 * interaction. Clicking a card sends the prompt through the same text
 * pipeline that AvatarTextInput uses, so it works identically whether the
 * user clicks or types.
 *
 * Each group maps to a backend capability the Nova Sonic agent can actually
 * execute with the Gateway tools it has access to:
 *   - Menu & Dining   → gateway_kb_search (pipeline=menu) + baked-in facts
 *   - Multilingual    → Nova Sonic native multilingual voice
 *   - Create          → gateway_nova_canvas_generate + gateway_website_generator
 *   - Research Recall → gateway_kb_search across the user-selected pipelines
 */

import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import { UtensilsCrossed, Globe2, Sparkles, Archive } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface AvatarSuggestedPromptsProps {
    onSelect: (prompt: string) => void;
    disabled?: boolean;
}

interface PromptGroup {
    title: string;
    icon: LucideIcon;
    prompts: { label: string; prompt: string }[];
}

const GROUPS: PromptGroup[] = [
    {
        title: "Menu & Dining",
        icon: UtensilsCrossed,
        prompts: [
            {
                label: "Tonight's specials",
                prompt: "What's on the dinner menu tonight?",
            },
            {
                label: "Vegetarian options",
                prompt: "Do you have gluten-free or vegetarian mains?",
            },
        ],
    },
    {
        title: "Multilingual",
        icon: Globe2,
        prompts: [
            {
                label: "Español",
                prompt: "¿Qué mariscos me recomiendas esta noche?",
            },
            {
                label: "Wine pairing",
                prompt: "What wine would pair with the halibut?",
            },
        ],
    },
    {
        title: "Create",
        icon: Sparkles,
        prompts: [
            {
                label: "Generate an image",
                prompt: "Create a photo of a cedar-plank salmon dish on a slate plate",
            },
            {
                label: "Build a website",
                prompt: "Build a one-page landing site for a seasonal seafood tasting menu",
            },
        ],
    },
    {
        title: "Research recall",
        icon: Archive,
        prompts: [
            {
                label: "Past reports",
                prompt: "Summarize the last research report I generated",
            },
            {
                label: "Cross-report",
                prompt: "What common themes appear across my research library?",
            },
        ],
    },
];

export default function AvatarSuggestedPrompts({
    onSelect,
    disabled,
}: AvatarSuggestedPromptsProps): JSX.Element {
    return (
        <div className="avatar-page__suggestions">
            <Header variant="h3">Try asking</Header>
            <Box variant="small" color="text-body-secondary" margin={{ bottom: "m" }}>
                Tap any card to send it, or speak/type your own.
            </Box>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {GROUPS.map((group) => {
                    const Icon = group.icon;
                    return (
                        <div key={group.title} className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <Icon
                                    className="w-4 h-4"
                                    style={{ color: "var(--app-text-secondary)" }}
                                />
                                <Box variant="h4" fontSize="heading-xs">
                                    {group.title}
                                </Box>
                            </div>
                            {group.prompts.map((p) => (
                                <button
                                    key={p.label}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => onSelect(p.prompt)}
                                    className="text-left cursor-pointer bg-transparent border-0 p-0 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <Container
                                        header={
                                            <Header variant="h3" description={p.prompt}>
                                                {p.label}
                                            </Header>
                                        }
                                    />
                                </button>
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
