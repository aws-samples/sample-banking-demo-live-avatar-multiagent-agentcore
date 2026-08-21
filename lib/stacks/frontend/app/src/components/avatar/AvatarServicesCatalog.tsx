/**
 * Persistent services-catalog panel for the Avatar/Digital Human.
 *
 * Baseline requirement: the avatar must be able to show the menu item it is
 * discussing and switch it as the customer's questions change. This panel does
 * that — it lists the bank's services and highlights whichever one the avatar
 * most recently referenced in its speech, scrolling it into view.
 *
 * Grounding to step 2: when the AI Assistant has generated a catalog this
 * session, that catalog (its text AND generated images) lives in the shared
 * `menuState` store, and this panel renders it directly. With no generated
 * catalog yet, it falls back to a static baseline aligned to BANK_FACTS
 * (patterns/avatar-agent/persona_prompts.py) so the panel is never empty.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "react-oidc-context";
import { useChatStore } from "@/stores/chatStore";
import { signCatalogImages } from "@/services/websiteShowcaseService";
import type { MenuSection } from "@/components/menu/MenuContext";

/** Static fallback, aligned to BANK_FACTS. `match` holds the aliases the avatar
 *  is likely to say so the highlight tracks natural speech, not just exact names. */
interface BaselineItem {
    name: string;
    price: string;
    description: string;
    badges: string[];
    match: string[];
}

const BASELINE_SECTIONS: { category: string; items: BaselineItem[] }[] = [
    {
        category: "Everyday Banking",
        items: [
            {
                name: "Everyday Checking",
                price: "No monthly fee",
                description: "No minimum balance, fee-free network ATMs, full digital banking.",
                badges: ["FDIC", "No Fee"],
                match: ["everyday checking", "checking"],
            },
            {
                name: "High-Yield Savings",
                price: "4.15% APY",
                description: "No monthly fee, interest compounded daily.",
                badges: ["FDIC", "4.15% APY"],
                match: ["high-yield savings", "high yield savings", "savings", "hysa"],
            },
        ],
    },
    {
        category: "Retirement & Investing",
        items: [
            {
                name: "Traditional & Roth IRAs",
                price: "Self-directed or managed",
                description: "Tax-advantaged retirement accounts with flexible options.",
                badges: ["IRA", "Retirement"],
                match: ["ira", "iras", "roth", "traditional", "retirement"],
            },
            {
                name: "Trinity Managed Portfolios",
                price: "Discretionary advisory",
                description: "Diversified model portfolios managed on your behalf.",
                badges: ["Advised", "Investing"],
                match: ["managed portfolios", "managed investing", "portfolio", "portfolios"],
            },
            {
                name: "Private Client",
                price: "Qualifying households",
                description: "Dedicated relationship manager and wealth management.",
                badges: ["Wealth", "Private"],
                match: ["private client", "wealth management", "private banking"],
            },
        ],
    },
];

interface CatalogEntry {
    name: string;
    price?: string;
    description?: string;
    badges: string[];
    imageUrl?: string;
    /** Durable image key, re-signed at render time (the generation-time
     *  imageUrl expires within the hour). */
    s3Key?: string;
    /** Lowercased terms used to detect a mention in the avatar's speech. */
    matchTerms: string[];
}

interface CatalogSection {
    category: string;
    items: CatalogEntry[];
}

/** Split a name into meaningful lowercase words for loose matching. */
function nameTerms(name: string): string[] {
    const lower = name.toLowerCase();
    const words = lower.split(/[^a-z0-9%]+/).filter((w) => w.length >= 4);
    return Array.from(new Set([lower, ...words]));
}

/**
 * The catalog the panel should show: the generated one from the AI Assistant if
 * present, otherwise the static baseline. Memoized on the menu sections.
 */
export function useAvatarCatalog(): CatalogSection[] {
    const menuSections = useChatStore((s) => s.menuState.sections);

    return useMemo(() => {
        const generated: MenuSection[] = menuSections ?? [];
        const hasGenerated = generated.some((s) => s.items.length > 0);

        if (hasGenerated) {
            return generated
                .filter((s) => s.items.length > 0)
                .map((s) => ({
                    category: s.category,
                    items: s.items.map((it) => ({
                        name: it.name,
                        price: it.price,
                        description: it.description,
                        badges: it.dietary ?? [],
                        imageUrl: it.imageUrl,
                        s3Key: it.s3_key,
                        matchTerms: nameTerms(it.name),
                    })),
                }));
        }

        return BASELINE_SECTIONS.map((s) => ({
            category: s.category,
            items: s.items.map((it) => ({
                name: it.name,
                price: it.price,
                description: it.description,
                badges: it.badges,
                matchTerms: it.match,
            })),
        }));
    }, [menuSections]);
}

/**
 * Which catalog item is the given text most recently talking about? Returns the
 * item name whose match term appears latest in the text, or null. Used to track
 * the item the avatar is currently discussing.
 */
export function findActiveItem(text: string, sections: CatalogSection[]): string | null {
    if (!text) return null;
    const hay = text.toLowerCase();
    let bestName: string | null = null;
    let bestIdx = -1;
    for (const section of sections) {
        for (const item of section.items) {
            for (const term of item.matchTerms) {
                const idx = hay.lastIndexOf(term);
                if (idx > bestIdx) {
                    bestIdx = idx;
                    bestName = item.name;
                }
            }
        }
    }
    return bestName;
}

interface AvatarServicesCatalogProps {
    /** Name of the item the avatar is currently discussing (highlighted). */
    activeItemName: string | null;
    /** Send a prompt when a card is clicked, so the user can steer the avatar. */
    onSelect?: (prompt: string) => void;
    disabled?: boolean;
}

export default function AvatarServicesCatalog({
    activeItemName,
    onSelect,
    disabled,
}: AvatarServicesCatalogProps): JSX.Element {
    const sections = useAvatarCatalog();
    const generated = useChatStore((s) => s.menuState.sections.some((sec) => sec.items.length > 0));
    const activeRef = useRef<HTMLButtonElement | null>(null);
    const auth = useAuth();
    const idToken = auth.user?.id_token;

    // Keep the item under discussion visible as the conversation moves.
    useEffect(() => {
        activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, [activeItemName]);

    // Re-sign product images from their durable s3_keys. The imageUrl captured
    // when the catalog was generated is a presigned URL that expires within the
    // hour (and always after a reload), so it renders broken on the avatar
    // panel. Mint fresh URLs keyed by s3_key and prefer those.
    const [signedImages, setSignedImages] = useState<Record<string, string>>({});
    const s3KeyList = useMemo(() => {
        const keys: string[] = [];
        for (const section of sections) {
            for (const item of section.items) {
                if (item.s3Key) keys.push(item.s3Key);
            }
        }
        return keys;
    }, [sections]);
    const s3KeysKey = s3KeyList.join(",");

    useEffect(() => {
        if (!idToken || s3KeyList.length === 0) return;
        let cancelled = false;
        void signCatalogImages(s3KeyList, idToken).then((map) => {
            if (!cancelled) setSignedImages(map);
        });
        return () => {
            cancelled = true;
        };
        // s3KeysKey stands in for the (stable) key list to avoid re-fetching on
        // every render while still refreshing when the catalog changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idToken, s3KeysKey]);

    return (
        <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
            <div
                className="flex items-baseline justify-between px-4 py-3"
                style={{ borderBottom: "1px solid var(--glass-border)" }}
            >
                <h3 className="text-sm font-semibold" style={{ color: "var(--app-text)" }}>
                    Services Catalog
                </h3>
                <span className="text-[10.5px]" style={{ color: "var(--app-text-muted)" }}>
                    {generated ? "Your generated catalog" : "Bank services"}
                </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
                {sections.map((section) => (
                    <div key={section.category} className="mb-4">
                        <p
                            className="numeric px-1 pb-1.5 text-[9.5px] tracking-[0.14em] uppercase"
                            style={{ color: "var(--app-text-muted)" }}
                        >
                            {section.category}
                        </p>
                        <div className="flex flex-col gap-2">
                            {section.items.map((item) => {
                                const active = item.name === activeItemName;
                                return (
                                    <button
                                        key={item.name}
                                        ref={active ? activeRef : undefined}
                                        type="button"
                                        disabled={disabled || !onSelect}
                                        onClick={() => onSelect?.(`Tell me about the ${item.name}`)}
                                        aria-current={active ? "true" : undefined}
                                        className="w-full rounded-lg border p-2.5 text-left transition-all disabled:cursor-default"
                                        style={{
                                            borderColor: active
                                                ? "var(--brand-accent)"
                                                : "var(--app-border)",
                                            background: active
                                                ? "var(--app-surface-raised)"
                                                : "var(--app-surface)",
                                            boxShadow: active
                                                ? "0 0 0 1px var(--brand-accent)"
                                                : "none",
                                            cursor: onSelect && !disabled ? "pointer" : "default",
                                        }}
                                    >
                                        <div className="flex items-start gap-2.5">
                                            {(() => {
                                                const src =
                                                    (item.s3Key && signedImages[item.s3Key]) ||
                                                    item.imageUrl;
                                                return src ? (
                                                    <img
                                                        src={src}
                                                        alt=""
                                                        className="h-11 w-11 shrink-0 rounded object-cover"
                                                        // A stale/broken URL should leave the card
                                                        // clean rather than show a broken-image icon.
                                                        onError={(e) => {
                                                            e.currentTarget.style.display = "none";
                                                        }}
                                                    />
                                                ) : null;
                                            })()}
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span
                                                        className="truncate text-[13px] font-medium"
                                                        style={{ color: "var(--app-text)" }}
                                                    >
                                                        {item.name}
                                                    </span>
                                                    {active && (
                                                        <span
                                                            className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                                                            style={{
                                                                background: "var(--brand-accent)",
                                                                color: "#0a0d12",
                                                            }}
                                                        >
                                                            Discussing
                                                        </span>
                                                    )}
                                                </div>
                                                {item.price && (
                                                    <div
                                                        className="numeric text-[11px]"
                                                        style={{
                                                            color: "var(--app-text-secondary)",
                                                        }}
                                                    >
                                                        {item.price}
                                                    </div>
                                                )}
                                                {item.description && (
                                                    <p
                                                        className="mt-0.5 line-clamp-2 text-[11px] leading-snug"
                                                        style={{ color: "var(--app-text-muted)" }}
                                                    >
                                                        {item.description}
                                                    </p>
                                                )}
                                                {item.badges.length > 0 && (
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {item.badges.slice(0, 3).map((b) => (
                                                            <span
                                                                key={b}
                                                                className="rounded px-1.5 py-0.5 text-[9px]"
                                                                style={{
                                                                    background:
                                                                        "var(--app-surface)",
                                                                    border: "1px solid var(--app-border)",
                                                                    color: "var(--app-text-muted)",
                                                                }}
                                                            >
                                                                {b}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
