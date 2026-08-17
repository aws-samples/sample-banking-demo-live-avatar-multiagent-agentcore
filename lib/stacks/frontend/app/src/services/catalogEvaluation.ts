/**
 * Deterministic scoring for catalog copy, used by the read-only A/B model
 * evaluation record.
 *
 * Every score here is COMPUTED FROM THE ACTUAL TEXT by the transparent rules
 * below — no model call, no stored guesses. That matters because the panel is a
 * review artifact shown to an audience: an invented number would be
 * indefensible if someone asked how it was derived.
 *
 * The rules mirror the constraints the catalog designer is prompted with (one
 * sentence, 15-30 words, benefit-led, on-brand), so the scorecard measures the
 * brief the copy was actually written against.
 */

export interface EvaluationDimension {
    label: string;
    /** 0-100 */
    score: number;
    /** How this dimension was measured, shown on hover. */
    detail: string;
}

export interface EvaluationResult {
    dimensions: EvaluationDimension[];
    /** Rounded mean of the dimensions. */
    overall: number;
    wordCount: number;
}

/** Benefit language the catalog brief asks for. */
const BENEFIT_TERMS = [
    "earn",
    "maximize",
    "grow",
    "protect",
    "protection",
    "access",
    "flexible",
    "flexibility",
    "competitive",
    "no monthly fee",
    "no minimum",
    "unlimited",
    "secure",
    "save",
    "savings",
    "rewards",
    "benefit",
    "tax-free",
    "tax-deferred",
];

/** Hype the brand voice avoids — unverifiable superlatives. */
const HYPE_TERMS = [
    "best ever",
    "world-class",
    "unbeatable",
    "revolutionary",
    "amazing",
    "incredible",
    "game-changing",
    "unmatched",
];

function clamp(n: number): number {
    return Math.max(0, Math.min(100, Math.round(n)));
}

function countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Score one description against the catalog brief.
 *
 * Returns zeroed dimensions for empty text rather than throwing, so a missing
 * description renders as an obvious 0 instead of breaking the card.
 */
export function evaluateDescription(text: string): EvaluationResult {
    const clean = (text ?? "").trim();
    const words = countWords(clean);

    if (!clean) {
        const empty = "No description to measure.";
        return {
            wordCount: 0,
            overall: 0,
            dimensions: [
                { label: "Length compliance", score: 0, detail: empty },
                { label: "Clarity", score: 0, detail: empty },
                { label: "Benefit-led", score: 0, detail: empty },
                { label: "Brand voice", score: 0, detail: empty },
            ],
        };
    }

    // Length compliance: the brief asks for 15-30 words. Full marks inside the
    // window, tapering by distance outside it.
    const lengthScore =
        words >= 15 && words <= 30
            ? 100
            : words < 15
              ? clamp(100 - (15 - words) * 8)
              : clamp(100 - (words - 30) * 6);

    // Clarity: one idea per sentence reads best aloud, which this copy has to do
    // — the catalog is spoken back to the customer.
    const sentences = clean.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const avgSentenceWords = words / Math.max(1, sentences.length);
    const clarityScore = clamp(
        avgSentenceWords <= 25
            ? 100 - Math.max(0, avgSentenceWords - 18) * 3
            : 100 - (avgSentenceWords - 25) * 6
    );

    const lower = clean.toLowerCase();
    const benefitHits = BENEFIT_TERMS.filter((t) => lower.includes(t)).length;
    const benefitScore = clamp(55 + benefitHits * 15);

    const hypeHits = HYPE_TERMS.filter((t) => lower.includes(t)).length;
    // Sentence case and no hype is the house style.
    const brandScore = clamp(100 - hypeHits * 30 - (clean === clean.toUpperCase() ? 25 : 0));

    const dimensions: EvaluationDimension[] = [
        {
            label: "Length compliance",
            score: lengthScore,
            detail: `${words} words (brief asks for 15-30).`,
        },
        {
            label: "Clarity",
            score: clarityScore,
            detail: `${sentences.length} sentence(s), ~${Math.round(avgSentenceWords)} words each.`,
        },
        {
            label: "Benefit-led",
            score: benefitScore,
            detail: `${benefitHits} benefit term(s) present.`,
        },
        {
            label: "Brand voice",
            score: brandScore,
            detail: hypeHits > 0 ? `${hypeHits} unverifiable superlative(s).` : "No hype language.",
        },
    ];

    const overall = Math.round(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length);

    return { dimensions, overall, wordCount: words };
}
