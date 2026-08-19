/**
 * Single source of truth for the demo's identity and experience catalog.
 *
 * The nav rail, the home page cards and the sign-in screen all read from
 * EXPERIENCES so a label only ever changes in one place. Route paths are
 * unchanged from the underlying orchestrator modes — only the presentation
 * layer is rebranded.
 */

import { Boxes, History, Mic, MessagesSquare, Radar, type LucideIcon } from "lucide-react";

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
/**
 * Who an experience is built for.
 *
 * The brief states the platform "will have both internal and external
 * customers and you need to have the appropriate guardrails in place", so the
 * audience is a first-class attribute rather than cosmetic grouping — it maps
 * directly onto the knowledge-base read scope and the guardrail posture:
 *
 *  - `internal` surfaces may read the `strategy_research` corpus, which
 *    contains the business plan and staff salary bands.
 *  - `external` surfaces are customer-facing and carry Bedrock Guardrails +
 *    PII/DLP so that same salary/internal detail can never be disclosed.
 */
export type Audience = "internal" | "external";

export const AUDIENCE_META: Record<Audience, { label: string; blurb: string }> = {
    internal: {
        label: "Internal · Employees",
        blurb: "Strategy, authoring and governance. May read the internal research corpus.",
    },
    external: {
        label: "External · Customers",
        blurb: "Customer-facing channels. Guardrails and DLP enforced on every turn.",
    },
};

export interface Experience {
    to: string;
    label: string;
    subtitle: string;
    /** Longer copy for the home page cards and the nav rail's info popover. */
    description: string;
    /** The AWS capability this experience is chosen to showcase. */
    service: string;
    /** Internal (employee) or external (customer) facing. */
    audience: Audience;
    icon: LucideIcon;
    /**
     * Supporting/utility view rather than a core workflow stage. Shown in the
     * nav rail but excluded from the home page's numbered "stages" grid so the
     * four-stage framing stays intact.
     */
    secondary?: boolean;
}

export const EXPERIENCES: readonly Experience[] = [
    {
        to: "/research",
        label: "Deep Research Agent",
        subtitle: "Multi-agent · cited report",
        description:
            "Refines your mandate with an LLM, breaks it into sub-questions, coordinates parallel research across web and internal sources with human-in-the-loop review, and delivers a comprehensive cited PDF report with imagery and a services chapter.",
        service: "AgentCore Runtime · Gateway",
        // Internal: produces the business plan, operating model and staff
        // salary bands. Writes/reads the `strategy_research` corpus.
        audience: "internal",
        icon: Radar,
    },
    {
        to: "/menu",
        label: "AI Assistant",
        subtitle: "Grounded · quality-controlled",
        description:
            "Turns the research report into a customer-facing services catalog with text, generated imagery and speech. Automatic quality control, human review, A/B model comparison and a continuous feedback loop are all wired in.",
        service: "Amazon Nova · Code Interpreter",
        // External: a customer-facing channel. It answers product and services
        // questions from the published catalog, so it carries the same
        // Guardrails + PII/DLP posture as the other customer surfaces — the
        // internal research corpus behind it (salary bands, operating model)
        // must never reach a customer. The authoring controls it also exposes
        // (quality control, human review, A/B comparison, feedback) are operator
        // affordances on top of that customer-facing channel.
        audience: "external",
        icon: Boxes,
    },
    {
        to: "/chat",
        label: "AI Agent",
        subtitle: "RAG · KYC · guardrails",
        description:
            "Opens accounts and answers product questions grounded in the strategy PDF via prompt engineering and RAG. Guardrails and DLP block off-topic and sensitive requests, and every run reports comprehensiveness, accuracy, latency and cost.",
        service: "AgentCore Policy · Guardrails",
        // External: the bank's customer. It is grounded in the internal
        // strategy PDF, which is exactly why Guardrails + PII/DLP are required
        // here — salary and internal figures must never reach a customer. Its
        // per-run metrics report is the one internal-facing surface.
        audience: "external",
        icon: MessagesSquare,
    },
    {
        to: "/avatar",
        label: "Avatar/Digital Human",
        subtitle: "Live speech · multilingual",
        description:
            "Real-time speech-to-speech advisory with barge-in and tone control, grounded on the same corpus as the written channels.",
        service: "Amazon Nova Sonic",
        // External: marketing and promotion to customers and prospects,
        // grounded on the published services catalog with scope guardrails.
        audience: "external",
        icon: Mic,
    },
    {
        to: "/history",
        label: "Latest Reports",
        subtitle: "Deep research & catalog output",
        description:
            "The most recent output from the Deep Research Agent and AI Assistant, reopenable at any time. Download links are re-signed on every load, so reports never expire into an access error.",
        service: "Amazon DynamoDB · Amazon S3",
        // Internal: surfaces the strategy report and catalog runs to staff.
        audience: "internal",
        icon: History,
        secondary: true,
    },
] as const;

/** Core workflow stages (excludes supporting/utility views like Latest Reports). */
export const STAGE_EXPERIENCES: readonly Experience[] = EXPERIENCES.filter((e) => !e.secondary);

/** Experiences grouped by audience, internal first (it produces what external consumes). */
export const AUDIENCE_ORDER: readonly Audience[] = ["internal", "external"] as const;

export function experiencesByAudience(audience: Audience): readonly Experience[] {
    return EXPERIENCES.filter((e) => e.audience === audience);
}

/** Capability chips on the sign-in screen. */
export const SIGN_IN_HIGHLIGHTS = [
    "Deep Research",
    "Account Opening",
    "Live Advisory",
    "Policy & Evaluations",
] as const;
