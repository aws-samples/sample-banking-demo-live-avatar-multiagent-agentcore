/**
 * Feedback Service
 * Handles submission of user feedback to the backend API
 */

function getApiUrl(): string {
    const base = import.meta.env.VITE_FEEDBACK_API_URL;
    return base ? `${base}feedback` : "";
}

export interface FeedbackPayload {
    sessionId: string;
    message: string;
    feedbackType: "positive" | "negative";
    comment?: string;
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
