/**
 * Latest generated services website, for the Avatar/Digital Human showcase.
 *
 * The AI Assistant step publishes a client-facing website (one page, one
 * anchored section per product category). This fetches the most recent one for
 * the signed-in user with a freshly minted URL — nothing is cached, so an embed
 * opened long after generation still loads (same re-sign-per-request contract
 * as the PDF run history).
 */

export interface WebsiteSection {
    heading: string;
    anchor: string;
}

export interface LatestWebsite {
    title: string;
    /** Freshly signed inline URL, or null if signing failed / none exists. */
    url: string | null;
    sections: WebsiteSection[];
    createdAt: string;
}

function getApiUrl(): string {
    const base = import.meta.env.VITE_FEEDBACK_API_URL;
    return base ? `${base}website-latest` : "";
}

export async function fetchLatestWebsite(idToken: string): Promise<LatestWebsite | null> {
    const url = getApiUrl();
    if (!url) return null;
    try {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
        if (!response.ok) return null;
        const body = (await response.json()) as { website?: LatestWebsite | null };
        return body.website ?? null;
    } catch {
        // A showcase that cannot load must never break the live avatar session.
        return null;
    }
}

/** Section slug the website generator uses as the HTML anchor id. */
export function sectionAnchor(name: string): string {
    return name.toLowerCase().replace(/ /g, "-");
}
