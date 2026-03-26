/**
 * KB Reset Service
 * Handles Knowledge Base reset (delete generated docs + re-index)
 */

function getApiUrl(): string {
    const base = import.meta.env.VITE_FEEDBACK_API_URL;
    return base ? `${base}kb-reset` : "";
}

export interface KbResetResponse {
    deletedCount: number;
    ingestionJobId: string;
    status: string;
}

export async function resetKnowledgeBase(idToken: string): Promise<KbResetResponse> {
    const apiUrl = getApiUrl();

    const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
        },
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    return response.json();
}
