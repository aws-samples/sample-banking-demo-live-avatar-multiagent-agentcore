/**
 * Single source of truth for the demo's identity and experience catalog.
 *
 * The nav rail, the home page cards and the sign-in screen all read from
 * EXPERIENCES so a label only ever changes in one place. Route paths are
 * unchanged from the underlying orchestrator modes — only the presentation
 * layer is rebranded.
 */

import {
    BookOpen,
    Boxes,
    LineChart,
    Mic,
    MessagesSquare,
    Radar,
    type LucideIcon,
} from "lucide-react";

export const BRAND = {
    name: "Trinity Reserve",
    legalName: "Trinity Reserve Bank",
    tagline: "Retail · Wealth · Markets",
    descriptor: "AI Research & Advisory Platform",
    location: "Dallas, Texas",
    /** Shown once on the sign-in screen; the scenario data is entirely synthetic. */
    disclosure: "Demonstration environment · synthetic data",
} as const;

/**
 * Experience catalog. `group` drives placement in the nav rail:
 *   research — the two deep-research pipelines
 *   advisory — customer-facing assistants
 *   library  — read-only corpora
 */
export interface Experience {
    to: string;
    label: string;
    subtitle: string;
    /** Longer copy for the home page cards. */
    description: string;
    /** The AWS capability this experience is chosen to showcase. */
    service: string;
    icon: LucideIcon;
    group: "research" | "advisory" | "library";
}

export const EXPERIENCES: readonly Experience[] = [
    {
        to: "/research",
        label: "Market Strategy",
        subtitle: "Multi-agent · cited report",
        description:
            "A supervisor decomposes the mandate into sub-questions, runs section agents in parallel across web and internal sources, then synthesizes a cited strategy report as PDF.",
        service: "AgentCore Runtime · Harness",
        icon: Radar,
        group: "research",
    },
    {
        to: "/research-studio",
        label: "Market Intelligence",
        subtitle: "Any topic · jurisdiction-scoped",
        description:
            "Open research on any subject, with web search governed by an approved domain list and a published-date window so findings stay inside the regulatory perimeter.",
        service: "AgentCore Gateway · Web Search",
        icon: LineChart,
        group: "research",
    },
    {
        to: "/menu",
        label: "Services Catalog",
        subtitle: "Products · generated imagery",
        description:
            "Builds the client-facing product set — checking, savings, retirement, managed investing — with generated imagery and a print-ready disclosure document.",
        service: "Amazon Nova · Code Interpreter",
        icon: Boxes,
        group: "advisory",
    },
    {
        to: "/chat",
        label: "Client Advisor",
        subtitle: "KYC · onboarding · guardrails",
        description:
            "Opens accounts, screens eligibility, and answers product questions grounded in the strategy report — with deterministic policy in front of every tool call.",
        service: "AgentCore Policy · Guardrails",
        icon: MessagesSquare,
        group: "advisory",
    },
    {
        to: "/avatar",
        label: "Relationship Manager",
        subtitle: "Live speech · multilingual",
        description:
            "Real-time speech-to-speech advisory with barge-in and tone control, grounded on the same corpus as the written channels.",
        service: "Amazon Nova Sonic",
        icon: Mic,
        group: "advisory",
    },
    {
        to: "/archive",
        label: "Compliance Archive",
        subtitle: "Semantic search · audit",
        description:
            "Semantic search across every report and disclosure the platform has produced, scoped to the requesting identity.",
        service: "Amazon S3 Vectors",
        icon: BookOpen,
        group: "library",
    },
] as const;

export const NAV_GROUPS: readonly { id: Experience["group"]; label: string }[] = [
    { id: "research", label: "Research" },
    { id: "advisory", label: "Advisory" },
    { id: "library", label: "Library" },
] as const;

export function experiencesIn(group: Experience["group"]): Experience[] {
    return EXPERIENCES.filter((e) => e.group === group);
}

/** Capability chips on the sign-in screen. */
export const SIGN_IN_HIGHLIGHTS = [
    "Deep Research",
    "Account Opening",
    "Live Advisory",
    "Policy & Evaluations",
] as const;
