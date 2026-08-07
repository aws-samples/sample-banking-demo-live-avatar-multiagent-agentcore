/**
 * Single source of truth for the demo's identity and experience catalog.
 *
 * The nav rail, the home page cards and the sign-in screen all read from
 * EXPERIENCES so a label only ever changes in one place. Route paths are
 * unchanged from the underlying orchestrator modes — only the presentation
 * layer is rebranded.
 */

import { Boxes, Mic, MessagesSquare, Radar, type LucideIcon } from "lucide-react";

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
 * Experience catalog. The four experiences are shown as a flat list in the nav
 * rail; each carries a short subtitle for the rail and a longer description
 * that surfaces on the home page cards and behind the info icon on the rail.
 */
export interface Experience {
    to: string;
    label: string;
    subtitle: string;
    /** Longer copy for the home page cards and the nav rail's info popover. */
    description: string;
    /** The AWS capability this experience is chosen to showcase. */
    service: string;
    icon: LucideIcon;
}

export const EXPERIENCES: readonly Experience[] = [
    {
        to: "/research",
        label: "Deep Research Agent",
        subtitle: "Multi-agent · cited report",
        description:
            "Refines your mandate with an LLM, breaks it into sub-questions, coordinates parallel research across web and internal sources with human-in-the-loop review, and delivers a comprehensive cited PDF report with imagery and a services chapter.",
        service: "AgentCore Runtime · Gateway",
        icon: Radar,
    },
    {
        to: "/menu",
        label: "AI Assistant",
        subtitle: "Grounded · quality-controlled",
        description:
            "Turns the research report into a customer-facing services catalog with text, generated imagery and speech. Automatic quality control, human review, A/B model comparison and a continuous feedback loop are all wired in.",
        service: "Amazon Nova · Code Interpreter",
        icon: Boxes,
    },
    {
        to: "/chat",
        label: "AI Agent",
        subtitle: "RAG · KYC · guardrails",
        description:
            "Opens accounts and answers product questions grounded in the strategy PDF via prompt engineering and RAG. Guardrails and DLP block off-topic and sensitive requests, and every run reports comprehensiveness, accuracy, latency and cost.",
        service: "AgentCore Policy · Guardrails",
        icon: MessagesSquare,
    },
    {
        to: "/avatar",
        label: "Avatar/Digital Human",
        subtitle: "Live speech · multilingual",
        description:
            "Real-time speech-to-speech advisory with barge-in and tone control, grounded on the same corpus as the written channels.",
        service: "Amazon Nova Sonic",
        icon: Mic,
    },
] as const;

/** Capability chips on the sign-in screen. */
export const SIGN_IN_HIGHLIGHTS = [
    "Deep Research",
    "Account Opening",
    "Live Advisory",
    "Policy & Evaluations",
] as const;
