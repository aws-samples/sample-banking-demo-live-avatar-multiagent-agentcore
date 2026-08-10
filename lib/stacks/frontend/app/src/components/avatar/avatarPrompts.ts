/**
 * Starter prompts for the Voice Avatar, shared by the empty-state cards and the
 * "Examples" popout.
 *
 * One list, two presentations: the cards only appear before the first turn, and
 * a presenter still needs the same reference mid-conversation. Two copies would
 * drift, and a prompt that drifts here is worse than a cosmetic bug — see below.
 *
 * These map to the Avatar/Digital Human's baseline requirement: a photorealistic,
 * multilingual marketing & promotion assistant for the bank's services, grounded
 * in the step-2 services catalog, able to show/switch the item it is discussing,
 * and with demonstrable guardrails. Each group targets one of those:
 *   - Why choose us   → marketing/promotion pitch, grounded via gateway_kb_search
 *                       (services catalog) + baked-in facts
 *   - Show a service  → gateway_kb_search (pipeline=services); renders the catalog
 *                       card / opens the catalog PDF, and re-queries (switches the
 *                       item shown) on each new product asked about
 *   - Multilingual    → Nova Sonic native multilingual voice + persona tone
 *   - Test guardrails → an out-of-scope question the avatar should decline,
 *                       demonstrating the guardrail is effective
 *
 * Every product named in a prompt must exist in BANK_FACTS
 * (patterns/avatar-agent/persona_prompts.py). The persona prompt forbids
 * inventing products, so a card naming one that isn't there forces the agent to
 * either contradict itself or tell the user the product doesn't exist.
 */

import { Sparkles, Landmark, Globe2, ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface PromptGroup {
    title: string;
    icon: LucideIcon;
    prompts: { label: string; prompt: string }[];
}

export const PROMPT_GROUPS: PromptGroup[] = [
    {
        title: "Why choose us",
        icon: Sparkles,
        prompts: [
            {
                label: "Why bank with us",
                prompt: "Why should I choose Trinity Reserve for my savings and everyday banking?",
            },
            {
                label: "What stands out",
                prompt: "What makes your High-Yield Savings and managed investing stand out?",
            },
        ],
    },
    {
        // Grounding + "show the item it is discussing, and change it per question":
        // each of these triggers a services kb_search that surfaces the catalog
        // card / PDF, and asking about a different product swaps what's shown.
        title: "Show me a service",
        icon: Landmark,
        prompts: [
            {
                label: "High-Yield Savings",
                prompt: "Show me the details of the High-Yield Savings account",
            },
            {
                label: "Switch the item",
                prompt: "Now show me the Everyday Checking account instead",
            },
        ],
    },
    {
        title: "Multilingual",
        icon: Globe2,
        prompts: [
            {
                label: "Español",
                prompt: "¿Por qué debería abrir una cuenta de ahorros con ustedes?",
            },
            {
                label: "Open an IRA",
                prompt: "How do I open a Roth IRA?",
            },
        ],
    },
    {
        // Demonstrates the guardrail: these are outside the bank's scope and the
        // avatar should politely decline rather than answer.
        title: "Test guardrails",
        icon: ShieldAlert,
        prompts: [
            {
                label: "Off-topic (declined)",
                prompt: "What's the weather forecast in Paris this weekend?",
            },
            {
                label: "Out of scope (declined)",
                prompt: "Give me medical advice about my headache",
            },
        ],
    },
];
