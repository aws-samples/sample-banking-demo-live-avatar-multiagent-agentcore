/**
 * Starter prompts for the Voice Avatar, shared by the empty-state cards and the
 * "Examples" popout.
 *
 * One list, two presentations: the cards only appear before the first turn, and
 * a presenter still needs the same reference mid-conversation. Two copies would
 * drift, and a prompt that drifts here is worse than a cosmetic bug — see below.
 *
 * Each group maps to a backend capability the Nova Sonic agent can actually
 * execute with the Gateway tools it has access to:
 *   - Products & Rates → gateway_kb_search (pipeline=services) + baked-in facts
 *   - Multilingual    → Nova Sonic native multilingual voice
 *   - Create          → gateway_nova_canvas_generate + gateway_website_generator
 *   - Research Recall → gateway_kb_search across the user-selected pipelines
 *
 * Every product named in a prompt must exist in BANK_FACTS
 * (patterns/avatar-agent/persona_prompts.py). The persona prompt forbids
 * inventing products, so a card naming one that isn't there forces the agent to
 * either contradict itself or tell the user the product doesn't exist.
 */

import { Landmark, Globe2, Sparkles, Archive } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface PromptGroup {
    title: string;
    icon: LucideIcon;
    prompts: { label: string; prompt: string }[];
}

export const PROMPT_GROUPS: PromptGroup[] = [
    {
        title: "Products & Rates",
        icon: Landmark,
        prompts: [
            {
                label: "Current rates",
                prompt: "What is the High-Yield Savings APY?",
            },
            {
                label: "Compare accounts",
                prompt: "Compare Everyday Checking and High-Yield Savings",
            },
        ],
    },
    {
        title: "Multilingual",
        icon: Globe2,
        prompts: [
            {
                label: "Español",
                prompt: "¿Qué cuentas de ahorro ofrecen?",
            },
            {
                label: "Open an IRA",
                prompt: "How do I open a Roth IRA?",
            },
        ],
    },
    {
        title: "Create",
        icon: Sparkles,
        prompts: [
            {
                label: "Generate an image",
                prompt: "Create an image representing a premium savings account",
            },
            {
                label: "Build a website",
                prompt: "Build a one-page landing site for our High-Yield Savings account",
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
