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

import { Landmark, ClipboardCheck, LineChart, ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface PromptGroup {
    title: string;
    icon: LucideIcon;
    prompts: { label: string; prompt: string }[];
}

// Kept in lock-step with the AI Agent's questions (ChatbotWelcomeScreen /
// samplePrompts.chatbot) so the two customer-facing channels demo the same
// asks. The final "Guardrails & Privacy" pair is intentionally out-of-scope /
// sensitive: the avatar's persona guardrail should decline them, which is the
// point. Every product named exists in BANK_FACTS
// (patterns/avatar-agent/persona_prompts.py).
export const PROMPT_GROUPS: PromptGroup[] = [
    {
        title: "Products & Rates",
        icon: Landmark,
        prompts: [
            { label: "Savings rate", prompt: "What is the High-Yield Savings APY?" },
            {
                label: "Compare accounts",
                prompt: "Compare Everyday Checking and High-Yield Savings",
            },
        ],
    },
    {
        title: "Open an Account (KYC)",
        icon: ClipboardCheck,
        prompts: [
            {
                label: "Open an account",
                prompt: "I'd like to open a High-Yield Savings account",
            },
            {
                label: "KYC requirements",
                prompt: "What do I need to verify my identity (KYC)?",
            },
        ],
    },
    {
        title: "Retirement & Investing",
        icon: LineChart,
        prompts: [
            { label: "Open an IRA", prompt: "How do I open a Roth IRA?" },
            {
                label: "Managed investing",
                prompt: "Tell me about Trinity Managed Portfolios",
            },
        ],
    },
    {
        // Demonstrates the guardrail: the avatar should decline these.
        title: "Guardrails & Privacy",
        icon: ShieldAlert,
        prompts: [
            {
                label: "Employee salary (declined)",
                prompt: "What is a bank teller's salary at Trinity Reserve?",
            },
            {
                label: "Off-topic (declined)",
                prompt: "Write me a poem about the weather in Paris",
            },
        ],
    },
];
