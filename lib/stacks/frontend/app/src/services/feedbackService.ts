/**
 * Feedback Service
 * Handles submission of user feedback to the backend API
 */

function getApiUrl(): string {
    const base = import.meta.env.VITE_FEEDBACK_API_URL;
    return base ? `${base}feedback` : "";
}

/** Where a signal originated, so the loop dashboard can slice by signal type. */
export type FeedbackSource =
    | "catalog_rating"
    | "chat_rating"
    | "edit"
    | "ab_test"
    /** A designer-prompt refinement generated from feedback and applied. */
    | "prompt_update";

export interface FeedbackMetadata {
    source?: FeedbackSource;
    /** Model that produced the accepted text (A/B winners). */
    model?: string;
    /** Catalog item / service the signal is about. */
    itemName?: string;
    /** Experience the signal came from, e.g. "menu". */
    experience?: string;
    /** Structured reason tags chosen in the vote popup (e.g. "Too long"). */
    reasons?: string[];
    /** The text the signal is about (the description voted on), for the loop optimizer. */
    text?: string;
}

export interface FeedbackPayload {
    sessionId: string;
    message: string;
    feedbackType: "positive" | "negative";
    comment?: string;
    metadata?: FeedbackMetadata;
}

export interface FeedbackResponse {
    success: boolean;
    feedbackId: string;
}

export async function submitFeedback(
    payload: FeedbackPayload,
    idToken: string
): Promise<FeedbackResponse> {
    try {
        const apiUrl = getApiUrl();

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data: FeedbackResponse = await response.json();
        return data;
    } catch (error) {
        console.error("Error submitting feedback:", error);
        throw error;
    }
}
