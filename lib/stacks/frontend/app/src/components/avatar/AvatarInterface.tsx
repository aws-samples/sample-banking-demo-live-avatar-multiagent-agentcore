import { useCallback, useEffect, useRef, useState } from "react";
import {
    Mic,
    MicOff,
    Phone,
    PhoneOff,
    Image,
    Video,
    HandMetal,
    Settings2,
    ChevronDown,
    Wrench,
    Bot,
    Circle,
    Diamond,
} from "lucide-react";
import type { AvatarVariantName } from "./AvatarVariant";
import Button from "@cloudscape-design/components/button";
import Alert from "@cloudscape-design/components/alert";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import Textarea from "@cloudscape-design/components/textarea";
import { PersonaSelector } from "./PersonaSelector";
import { LanguageSelector } from "./LanguageSelector";
import { VoiceSelector } from "./VoiceSelector";
import Avatar3DReactWrapper from "./Avatar3DReactWrapper";
import WebsiteMonitor from "./WebsiteMonitor";
import { useAudioPlayer, AudioPlayerControls } from "./AudioPlayer";
import { MarkdownRenderer } from "../chat/MarkdownRenderer";
import { KbSearchResultCard } from "../chat/KbSearchResultCard";
import PdfViewer from "../viewer/PdfViewer";
import {
    AvatarWebSocketClient,
    type AvatarWSMessage,
    type ConnectionState,
    type PersonaId,
} from "@/lib/websocket-client/client";
import {
    type LanguageCode,
    getDefaultVoice,
    getVoicesForLanguage,
    VOICES,
} from "@/lib/websocket-client/voice-config";
import { presignAgentCoreWebSocket } from "@/lib/websocket-client/sigv4";
import { getAWSCredentials } from "@/lib/auth/credentials";
import { createPCMProcessorUrl, arrayBufferToBase64 } from "@/lib/websocket-client/audio-utils";
import AvatarTextInput from "./AvatarTextInput";
import { useAuth } from "react-oidc-context";
import "./AvatarPage.css";

type TranscriptSegment =
    | { kind: "text"; content: string }
    | { kind: "media"; mediaType: "image" | "video"; url: string; toolName: string }
    | { kind: "tool"; toolName: string; status: "running" | "done"; input?: string }
    | { kind: "kb"; resultJson: string }
    | { kind: "website"; url: string; title?: string; s3_key?: string };

interface TranscriptEntry {
    role: "user" | "assistant" | "system";
    segments: TranscriptSegment[];
    timestamp: string;
}

interface ToolResultMedia {
    type: "image" | "video";
    url: string;
    toolName: string;
    timestamp: string;
}

interface PdfPreviewData {
    url: string;
    filename?: string;
    page?: number;
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant. Provide clear, accurate, and friendly responses to user queries. Always be respectful and professional in your interactions.`;

const LOCALSTORAGE_PROMPT_KEY = "avatar-system-prompt";

const connectionStatusMap: Record<
    ConnectionState,
    { type: "success" | "in-progress" | "stopped" | "error"; label: string }
> = {
    connected: { type: "success", label: "Connected" },
    connecting: { type: "in-progress", label: "Connecting" },
    reconnecting: { type: "in-progress", label: "Reconnecting" },
    disconnected: { type: "stopped", label: "Disconnected" },
    error: { type: "error", label: "Error" },
};

function formatTimer(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AvatarInterface(): JSX.Element {
    // --- Connection & core state ---
    const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
    const [persona, setPersona] = useState<PersonaId>("friendly");
    const [language, setLanguage] = useState<LanguageCode>("en-US");
    const [voiceId, setVoiceId] = useState(() => getDefaultVoice("en-US").id);
    const [isRecording, setIsRecording] = useState(false);
    const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
    const [mediaResults, setMediaResults] = useState<ToolResultMedia[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [audioLevel, setAudioLevel] = useState(0);
    const [config, setConfig] = useState<{
        avatarRuntimeArn: string;
        awsRegion: string;
        identityPoolId?: string;
        cognitoUserPoolId?: string;
    } | null>(null);

    // --- New feature state ---
    const [sessionSeconds, setSessionSeconds] = useState(0);
    const [interruptCount, setInterruptCount] = useState(0);
    const [pdfPreview, setPdfPreview] = useState<PdfPreviewData | null>(null);
    const [websitePreview, setWebsitePreview] = useState<string | null>(null);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const [showPromptEditor, setShowPromptEditor] = useState(false);
    const [systemPrompt, setSystemPrompt] = useState(() => {
        return localStorage.getItem(LOCALSTORAGE_PROMPT_KEY) || DEFAULT_SYSTEM_PROMPT;
    });

    // --- Avatar variant ---
    const [avatarVariant, setAvatarVariant] = useState<AvatarVariantName>(() => {
        return (localStorage.getItem("avatar-variant") as AvatarVariantName) || "robot";
    });

    // --- Smart auto-scroll state ---
    const [isUserScrolling, setIsUserScrolling] = useState(false);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastMessageCountRef = useRef(0);

    // --- Refs ---
    const wsClientRef = useRef<AvatarWebSocketClient | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const sessionIdRef = useRef(crypto.randomUUID());
    const transcriptRef = useRef<HTMLDivElement>(null);
    const transcriptEndRef = useRef<HTMLDivElement>(null);
    const currentAssistantTextRef = useRef("");
    const currentUserTextRef = useRef("");
    const lastRoleRef = useRef<"user" | "assistant" | null>(null);
    const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const auth = useAuth();
    const { enqueueAudio, clearQueue, isPlaying, volume, setVolume, isMuted, toggleMute } =
        useAudioPlayer();

    // --- Load config ---
    useEffect(() => {
        const avatarArn = import.meta.env.VITE_RUNTIME_ARN_AVATAR;
        if (!avatarArn) {
            setError("Config error: Avatar Runtime ARN not found");
            return;
        }
        setConfig({
            avatarRuntimeArn: avatarArn,
            awsRegion: import.meta.env.VITE_REGION || "us-east-1",
            identityPoolId: import.meta.env.VITE_IDENTITY_POOL_ID,
            cognitoUserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
        });
    }, []);

    // --- Session timer ---
    useEffect(() => {
        if (connectionState === "connected") {
            setSessionSeconds(0);
            sessionTimerRef.current = setInterval(() => {
                setSessionSeconds((prev) => prev + 1);
            }, 1000);
        } else {
            if (sessionTimerRef.current) {
                clearInterval(sessionTimerRef.current);
                sessionTimerRef.current = null;
            }
            if (connectionState === "disconnected") {
                setSessionSeconds(0);
            }
        }
        return () => {
            if (sessionTimerRef.current) {
                clearInterval(sessionTimerRef.current);
            }
        };
    }, [connectionState]);

    // --- Reset audioLevel when playback stops ---
    useEffect(() => {
        if (!isPlaying) {
            setAudioLevel(0);
        }
    }, [isPlaying]);

    // --- Smart auto-scroll ---
    useEffect(() => {
        if (!isUserScrolling && transcriptEndRef.current) {
            transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
        // Show "new messages" button if user is scrolled up and new messages arrived
        if (isUserScrolling && transcript.length > lastMessageCountRef.current) {
            setShowScrollToBottom(true);
        }
        if (!isUserScrolling) {
            lastMessageCountRef.current = transcript.length;
        }
    }, [transcript, isUserScrolling]);

    // Re-scroll after images load (they change scroll height after rendering)
    useEffect(() => {
        if (!isUserScrolling && transcriptEndRef.current) {
            const timer = setTimeout(() => {
                transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [mediaResults.length, isUserScrolling]);

    useEffect(() => {
        const el = transcriptRef.current;
        if (!el) return;

        const handleScroll = () => {
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;

            if (!nearBottom) {
                setIsUserScrolling(true);
                if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                // Auto-resume scroll after 2s idle
                scrollTimeoutRef.current = setTimeout(() => {
                    setIsUserScrolling(false);
                    setShowScrollToBottom(false);
                }, 2000);
            } else {
                setIsUserScrolling(false);
                setShowScrollToBottom(false);
                lastMessageCountRef.current = transcript.length;
                if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
            }
        };

        el.addEventListener("scroll", handleScroll, { passive: true });
        return () => {
            el.removeEventListener("scroll", handleScroll);
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        };
    }, [transcript.length]);

    const scrollToBottom = useCallback(() => {
        if (transcriptRef.current) {
            transcriptRef.current.scrollTo({
                top: transcriptRef.current.scrollHeight,
                behavior: "smooth",
            });
            setIsUserScrolling(false);
            setShowScrollToBottom(false);
            lastMessageCountRef.current = transcript.length;
        }
    }, [transcript.length]);

    // --- Gender-preserving voice on language change ---
    const handleLanguageChange = useCallback(
        (newLang: LanguageCode): void => {
            setLanguage(newLang);
            // Find the gender of the current voice
            const currentVoice = VOICES.find((v) => v.id === voiceId);
            const currentGender = currentVoice?.gender ?? "female";
            // Pick a voice in the new language with matching gender
            const newLangVoices = getVoicesForLanguage(newLang);
            const matchingVoice =
                newLangVoices.find((v) => v.gender === currentGender) ?? newLangVoices[0];
            const newVoiceId = matchingVoice?.id ?? getDefaultVoice(newLang).id;
            setVoiceId(newVoiceId);
            wsClientRef.current?.updateLanguage(newLang);
            wsClientRef.current?.updateVoice(newVoiceId);
        },
        [voiceId]
    );

    const handleVoiceChange = useCallback((newVoiceId: string): void => {
        setVoiceId(newVoiceId);
        wsClientRef.current?.updateVoice(newVoiceId);
    }, []);

    // --- WebSocket message handler ---
    const handleWSMessage = useCallback(
        (message: AvatarWSMessage): void => {
            switch (message.type) {
                case "audio":
                    if (message.audioData) {
                        enqueueAudio(message.audioData);
                        setAudioLevel(Math.min(1, message.audioData.length / 5000));
                    }
                    break;

                case "text":
                    if (message.content) {
                        const role = message.role ?? "assistant";
                        const isNewTurn = role !== lastRoleRef.current;
                        lastRoleRef.current = role;

                        if (role === "user") {
                            // User transcript from speech recognition
                            if (isNewTurn) {
                                currentUserTextRef.current = "";
                            }
                            // Deduplicate repeated transcript
                            if (
                                currentUserTextRef.current.length > 0 &&
                                message.content.length > 3 &&
                                currentUserTextRef.current.endsWith(message.content)
                            ) {
                                break;
                            }
                            currentUserTextRef.current += message.content;
                            setTranscript((prev) => {
                                const updated = [...prev];
                                // Remove the placeholder "[Speaking...]" entry if it's the last user entry
                                const lastIdx = updated.length - 1;
                                const last = updated[lastIdx];
                                if (last && last.role === "user") {
                                    const seg = last.segments[0];
                                    if (
                                        seg?.kind === "text" &&
                                        (seg.content === "[Speaking...]" || !isNewTurn)
                                    ) {
                                        updated[lastIdx] = {
                                            ...last,
                                            segments: [
                                                {
                                                    kind: "text",
                                                    content: currentUserTextRef.current,
                                                },
                                            ],
                                        };
                                        return updated;
                                    }
                                }
                                // New user bubble
                                updated.push({
                                    role: "user",
                                    segments: [
                                        { kind: "text", content: currentUserTextRef.current },
                                    ],
                                    timestamp: new Date().toISOString(),
                                });
                                return updated;
                            });
                        } else {
                            // Assistant response
                            if (isNewTurn) {
                                currentAssistantTextRef.current = "";
                            }
                            // Deduplicate: Nova Sonic sends streaming chunks then a final
                            // complete transcript, and may also re-send overlapping text
                            // across multiple response turns (e.g. before/after tool calls).

                            const existing = currentAssistantTextRef.current;
                            const incoming = message.content;

                            // Skip if incoming is already fully contained
                            if (
                                existing.length > 0 &&
                                incoming.length > 3 &&
                                existing.includes(incoming)
                            ) {
                                break;
                            }

                            // Detect overlap: if the start of incoming matches the end of existing,
                            // only append the non-overlapping suffix.
                            let textToAppend = incoming;
                            if (existing.length > 0 && incoming.length > 10) {
                                // Find the longest suffix of existing that is a prefix of incoming
                                const maxCheck = Math.min(existing.length, incoming.length);
                                let overlapLen = 0;
                                for (let len = maxCheck; len >= 10; len--) {
                                    if (existing.endsWith(incoming.substring(0, len))) {
                                        overlapLen = len;
                                        break;
                                    }
                                }
                                if (overlapLen > 0) {
                                    textToAppend = incoming.substring(overlapLen);
                                    if (textToAppend.length === 0) break;
                                }
                            }

                            // Strip URLs from assistant speech — the UI renders clickable cards instead
                            const cleaned = textToAppend.replace(/https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ");
                            currentAssistantTextRef.current += cleaned;
                            setTranscript((prev) => {
                                const updated = [...prev];
                                const last = updated[updated.length - 1];
                                if (
                                    last &&
                                    last.role === "assistant" &&
                                    last.segments[0]?.kind === "text"
                                ) {
                                    updated[updated.length - 1] = {
                                        ...last,
                                        segments: [
                                            {
                                                kind: "text",
                                                content: currentAssistantTextRef.current,
                                            },
                                        ],
                                    };
                                } else {
                                    updated.push({
                                        role: "assistant",
                                        segments: [
                                            {
                                                kind: "text",
                                                content: currentAssistantTextRef.current,
                                            },
                                        ],
                                        timestamp: new Date().toISOString(),
                                    });
                                }
                                return updated;
                            });
                        }
                    }
                    break;

                case "toolInvocation":
                    if (message.toolName) {
                        if (message.toolResult) {
                            // This is actually a tool result (old backend sends both as toolInvocation)
                            console.log("[Avatar KB Debug] toolInvocation with result", {
                                toolName: message.toolName,
                                hasToolResult: !!message.toolResult,
                                toolResultType: typeof message.toolResult,
                                toolResultPreview:
                                    typeof message.toolResult === "string"
                                        ? message.toolResult.substring(0, 300)
                                        : JSON.stringify(message.toolResult).substring(0, 300),
                            });
                            // Mark running tool as done
                            setTranscript((prev) => {
                                const updated = [...prev];
                                for (let i = updated.length - 1; i >= 0; i--) {
                                    const seg = updated[i].segments[0];
                                    if (
                                        seg?.kind === "tool" &&
                                        seg.toolName === message.toolName &&
                                        seg.status === "running"
                                    ) {
                                        updated[i] = {
                                            ...updated[i],
                                            segments: [{ ...seg, status: "done" }],
                                        };
                                        break;
                                    }
                                }
                                return updated;
                            });
                            // Extract media URLs from tool result JSON
                            try {
                                let resultData =
                                    typeof message.toolResult === "string"
                                        ? JSON.parse(message.toolResult)
                                        : message.toolResult;
                                // Unwrap MCP content wrapper: {content:[{type:"text",text:"..."}]}
                                if (resultData?.content?.[0]?.text) {
                                    try {
                                        resultData = JSON.parse(resultData.content[0].text);
                                    } catch {
                                        /* not nested JSON */
                                    }
                                }
                                const imgUrl = resultData?.image_url || message.mediaUrl;
                                const vidUrl = resultData?.video_url;
                                if (imgUrl) {
                                    setTranscript((prev) => [
                                        ...prev,
                                        {
                                            role: "assistant",
                                            segments: [
                                                {
                                                    kind: "media",
                                                    mediaType: "image",
                                                    url: imgUrl,
                                                    toolName: message.toolName!,
                                                },
                                            ],
                                            timestamp: new Date().toISOString(),
                                        },
                                    ]);
                                } else if (vidUrl) {
                                    setTranscript((prev) => [
                                        ...prev,
                                        {
                                            role: "assistant",
                                            segments: [
                                                {
                                                    kind: "media",
                                                    mediaType: "video",
                                                    url: vidUrl,
                                                    toolName: message.toolName!,
                                                },
                                            ],
                                            timestamp: new Date().toISOString(),
                                        },
                                    ]);
                                }
                                // Show KB search results inline in transcript (same pattern as Chat)
                                if (message.toolName!.includes("kb_search")) {
                                    const kbResultStr =
                                        typeof message.toolResult === "string"
                                            ? message.toolResult
                                            : JSON.stringify(resultData);
                                    console.log("[Avatar KB Debug] toolInvocation kb_search", {
                                        resultPreview: kbResultStr.substring(0, 300),
                                    });
                                    setTranscript((prev) => [
                                        ...prev,
                                        {
                                            role: "assistant",
                                            segments: [{ kind: "kb", resultJson: kbResultStr }],
                                            timestamp: new Date().toISOString(),
                                        },
                                    ]);
                                }
                                // Show website result as a card
                                if (
                                    message.toolName!.includes("website_generator") &&
                                    resultData?.success &&
                                    resultData?.url
                                ) {
                                    setTranscript((prev) => [
                                        ...prev,
                                        {
                                            role: "assistant",
                                            segments: [
                                                {
                                                    kind: "website",
                                                    url: resultData.url,
                                                    title: resultData.title,
                                                    s3_key: resultData.s3_key,
                                                },
                                            ],
                                            timestamp: new Date().toISOString(),
                                        },
                                    ]);
                                }
                            } catch {
                                // Result wasn't JSON — ignore
                            }
                        } else {
                            // Tool invocation start — show running indicator
                            setTranscript((prev) => [
                                ...prev,
                                {
                                    role: "system",
                                    segments: [
                                        {
                                            kind: "tool",
                                            toolName: message.toolName!,
                                            status: "running",
                                            input: message.toolInput,
                                        },
                                    ],
                                    timestamp: new Date().toISOString(),
                                },
                            ]);
                        }
                    }
                    break;

                case "toolResult":
                    console.log("[Avatar KB Debug] toolResult", {
                        toolName: message.toolName,
                        hasToolResult: !!message.toolResult,
                        toolResultType: typeof message.toolResult,
                        toolResultPreview: message.toolResult
                            ? typeof message.toolResult === "string"
                                ? message.toolResult.substring(0, 300)
                                : JSON.stringify(message.toolResult).substring(0, 300)
                            : "N/A",
                        hasMediaUrl: !!message.mediaUrl,
                        mediaType: message.mediaType,
                    });
                    // Mark running tool as done
                    if (message.toolName) {
                        setTranscript((prev) => {
                            const updated = [...prev];
                            for (let i = updated.length - 1; i >= 0; i--) {
                                const seg = updated[i].segments[0];
                                if (
                                    seg?.kind === "tool" &&
                                    seg.toolName === message.toolName &&
                                    seg.status === "running"
                                ) {
                                    updated[i] = {
                                        ...updated[i],
                                        segments: [{ ...seg, status: "done" }],
                                    };
                                    break;
                                }
                            }
                            return updated;
                        });
                    }

                    // Inline media in transcript + auto-popup for images
                    if (message.mediaUrl && message.mediaType) {
                        setMediaResults((prev) => [
                            ...prev,
                            {
                                type: message.mediaType!,
                                url: message.mediaUrl!,
                                toolName: message.toolName || "unknown",
                                timestamp: new Date().toISOString(),
                            },
                        ]);
                        setTranscript((prev) => [
                            ...prev,
                            {
                                role: "assistant",
                                segments: [
                                    {
                                        kind: "media",
                                        mediaType: message.mediaType!,
                                        url: message.mediaUrl!,
                                        toolName: message.toolName || "unknown",
                                    },
                                ],
                                timestamp: new Date().toISOString(),
                            },
                        ]);
                        // Auto-popup images so they're immediately visible
                        // Disabled — images show inline in chat; user clicks to enlarge
                    }

                    // Handle pdfPreview from toolResult
                    if (message.toolName === "pdfPreview" && message.mediaUrl) {
                        setPdfPreview({
                            url: message.mediaUrl,
                            filename: message.content,
                        });
                    }

                    // Show KB search results inline in transcript (same pattern as Chat)
                    // Backend now sends unwrapped toolResult (clean JSON string, not MCP wrapper)
                    if (message.toolName?.includes("kb_search") && message.toolResult) {
                        // Pass the result string directly to KbSearchResultCard,
                        // same as Chat's tool renderer system does
                        const resultStr =
                            typeof message.toolResult === "string"
                                ? message.toolResult
                                : JSON.stringify(message.toolResult);
                        console.log("[Avatar KB Debug] toolResult kb_search", {
                            resultPreview: resultStr.substring(0, 300),
                        });
                        setTranscript((prev) => [
                            ...prev,
                            {
                                role: "assistant",
                                segments: [{ kind: "kb", resultJson: resultStr }],
                                timestamp: new Date().toISOString(),
                            },
                        ]);
                    }

                    // Show website result as a clickable card
                    if (message.toolName?.includes("website_generator") && message.toolResult) {
                        try {
                            let wr =
                                typeof message.toolResult === "string"
                                    ? JSON.parse(message.toolResult)
                                    : message.toolResult;
                            if (wr?.content?.[0]?.text) {
                                try { wr = JSON.parse(wr.content[0].text); } catch { /* not nested */ }
                            }
                            if (wr?.success && wr?.url) {
                                setWebsitePreview(wr.url);
                                setTranscript((prev) => [
                                    ...prev,
                                    {
                                        role: "assistant",
                                        segments: [
                                            {
                                                kind: "website",
                                                url: wr.url,
                                                title: wr.title,
                                                s3_key: wr.s3_key,
                                            },
                                        ],
                                        timestamp: new Date().toISOString(),
                                    },
                                ]);
                            }
                        } catch { /* not JSON */ }
                    }

                    currentAssistantTextRef.current = "";
                    break;

                case "sessionStart":
                    setError(null);
                    break;

                case "sessionEnd":
                    setConnectionState("disconnected");
                    setAudioLevel(0);
                    break;

                case "error":
                    setError(message.content || "Unknown WebSocket error");
                    break;
            }

            // Handle pdfPreview as a standalone message type
            const raw = message as unknown as Record<string, unknown>;
            if (raw.type === "pdfPreview" && typeof raw.url === "string") {
                setPdfPreview({
                    url: raw.url as string,
                    filename: (raw.filename as string) ?? undefined,
                    page: (raw.page as number) ?? undefined,
                });
            }
        },
        [enqueueAudio]
    );

    // --- Send text to avatar ---
    const handleSendText = useCallback(
        (text: string): void => {
            if (!wsClientRef.current || connectionState !== "connected") return;

            setTranscript((prev) => [
                ...prev,
                {
                    role: "user",
                    segments: [{ kind: "text", content: text }],
                    timestamp: new Date().toISOString(),
                },
            ]);
            currentAssistantTextRef.current = "";
            lastRoleRef.current = "user";
            wsClientRef.current.sendText(text);
        },
        [connectionState]
    );

    // --- Connect ---
    const connect = useCallback(async (): Promise<void> => {
        if (!config || !auth.user?.access_token) {
            setError("Missing configuration or authentication");
            return;
        }

        setError(null);
        clearQueue();
        setInterruptCount(0);

        const client = new AvatarWebSocketClient(
            {
                runtimeArn: config.avatarRuntimeArn,
                region: config.awsRegion,
                accessToken: auth.user.access_token,
                sessionId: sessionIdRef.current,
                persona,
                language,
                voiceId,
            },
            handleWSMessage,
            setConnectionState
        );

        wsClientRef.current = client;

        // Try SigV4 presigned URL if Identity Pool is configured
        if (config.identityPoolId && config.cognitoUserPoolId && auth.user.id_token) {
            try {
                const credentials = await getAWSCredentials(
                    auth.user.id_token,
                    config.identityPoolId,
                    config.cognitoUserPoolId,
                    config.awsRegion
                );
                const presignedUrl = await presignAgentCoreWebSocket(
                    config.avatarRuntimeArn,
                    config.awsRegion,
                    credentials,
                    sessionIdRef.current,
                    { persona, language, voiceId }
                );
                console.log("[AvatarInterface] Connecting with SigV4 presigned URL");
                client.connect(presignedUrl);
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Unknown error";
                console.warn(
                    `[AvatarInterface] SigV4 presigning failed, falling back to bearer token: ${msg}`
                );
                client.connect();
            }
        } else {
            // Fall back to bearer token subprotocol
            console.log("[AvatarInterface] Connecting with bearer token subprotocol");
            client.connect();
        }
    }, [config, auth.user, persona, language, voiceId, handleWSMessage, clearQueue]);

    // --- Recording ---
    const stopRecording = useCallback((): void => {
        if (workletNodeRef.current) {
            workletNodeRef.current.disconnect();
            workletNodeRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== "closed") {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
        }
        setIsRecording(false);
    }, []);

    const disconnect = useCallback((): void => {
        stopRecording();
        wsClientRef.current?.disconnect();
        wsClientRef.current = null;
        clearQueue();
        setAudioLevel(0);
    }, [clearQueue, stopRecording]);

    const startRecording = useCallback(async (): Promise<void> => {
        if (!wsClientRef.current || connectionState !== "connected") return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            mediaStreamRef.current = stream;
            const audioCtx = new AudioContext({ sampleRate: 16000 });
            audioContextRef.current = audioCtx;

            const processorUrl = createPCMProcessorUrl();
            await audioCtx.audioWorklet.addModule(processorUrl);
            URL.revokeObjectURL(processorUrl);

            const source = audioCtx.createMediaStreamSource(stream);
            const workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");
            workletNodeRef.current = workletNode;

            workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
                const base64 = arrayBufferToBase64(event.data);
                wsClientRef.current?.sendAudio(base64);
            };

            source.connect(workletNode);
            workletNode.connect(audioCtx.destination);

            setIsRecording(true);

            setTranscript((prev) => [
                ...prev,
                {
                    role: "user",
                    segments: [{ kind: "text", content: "[Speaking...]" }],
                    timestamp: new Date().toISOString(),
                },
            ]);
            currentAssistantTextRef.current = "";
            currentUserTextRef.current = "";
            lastRoleRef.current = null;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Microphone access denied";
            setError(`Microphone error: ${msg}`);
        }
    }, [connectionState]);

    // --- Persona change ---
    const handlePersonaChange = useCallback((newPersona: PersonaId): void => {
        setPersona(newPersona);
        wsClientRef.current?.updatePersona(newPersona);
    }, []);

    // --- Barge-in interrupt ---
    const handleInterrupt = useCallback((): void => {
        if (!wsClientRef.current || connectionState !== "connected") return;
        setInterruptCount((prev) => prev + 1);
        // Send interrupt signal over WebSocket
        wsClientRef.current.sendText("[INTERRUPT]");
        // Clear the audio queue to immediately stop playback
        clearQueue();
        setAudioLevel(0);
    }, [connectionState, clearQueue]);

    // --- System prompt save ---
    const handleSavePrompt = useCallback((): void => {
        localStorage.setItem(LOCALSTORAGE_PROMPT_KEY, systemPrompt);
        setShowPromptEditor(false);
    }, [systemPrompt]);

    const handleResetPrompt = useCallback((): void => {
        setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
        localStorage.removeItem(LOCALSTORAGE_PROMPT_KEY);
    }, []);

    // --- Derived ---
    const isConnected = connectionState === "connected";
    const statusInfo = connectionStatusMap[connectionState];

    return (
        <div className="avatar-page">
            {/* Controls bar */}
            <div className="avatar-page__controls">
                <SpaceBetween direction="horizontal" size="s">
                    <PersonaSelector
                        value={persona}
                        onChange={handlePersonaChange}
                        disabled={isConnected}
                    />
                    <LanguageSelector
                        value={language}
                        onChange={handleLanguageChange}
                        disabled={isConnected}
                    />
                    <VoiceSelector
                        language={language}
                        value={voiceId}
                        onChange={handleVoiceChange}
                        disabled={isConnected}
                    />
                </SpaceBetween>

                <SpaceBetween direction="horizontal" size="s">
                    <AudioPlayerControls
                        volume={volume}
                        setVolume={setVolume}
                        isMuted={isMuted}
                        toggleMute={toggleMute}
                    />

                    <Button
                        variant="icon"
                        iconSvg={<Settings2 size={16} />}
                        onClick={() => setShowPromptEditor(true)}
                        ariaLabel="System Prompt Editor"
                    />

                    <StatusIndicator type={statusInfo.type}>{statusInfo.label}</StatusIndicator>

                    <span
                        className={`avatar-page__timer${isConnected ? " avatar-page__timer--active" : ""}`}
                    >
                        {formatTimer(sessionSeconds)}
                    </span>

                    {isConnected ? (
                        <Button
                            variant="normal"
                            onClick={disconnect}
                            iconSvg={<PhoneOff size={16} />}
                        >
                            Disconnect
                        </Button>
                    ) : (
                        <Button
                            variant="primary"
                            onClick={connect}
                            disabled={connectionState === "connecting" || !config}
                            iconSvg={<Phone size={16} />}
                        >
                            Connect
                        </Button>
                    )}
                </SpaceBetween>
            </div>

            {/* Error banner */}
            {error && (
                <div className="avatar-page__error">
                    <Alert type="error" dismissible onDismiss={() => setError(null)}>
                        {error}
                    </Alert>
                </div>
            )}

            {/* Main content grid */}
            <div className={`avatar-page__main${pdfPreview ? " avatar-page__main--with-pdf" : ""}`}>
                {/* Avatar column */}
                <div className="avatar-page__avatar-col">
                    <div className="avatar-page__avatar-header">
                        <h2>Virtual Assistant</h2>
                        <p>AI Avatar with real-time voice interaction</p>
                    </div>

                    <div className="avatar-page__avatar-canvas">
                        <Avatar3DReactWrapper
                            audioLevel={audioLevel}
                            isSpeaking={isPlaying}
                            isListening={isRecording}
                            className="w-full h-full"
                            variant={avatarVariant}
                        />

                        {/* Draggable website monitor overlay */}
                        {websitePreview && (
                            <WebsiteMonitor
                                url={websitePreview}
                                onClose={() => setWebsitePreview(null)}
                            />
                        )}
                        <div className="absolute bottom-2 left-2 flex gap-1">
                            {[
                                { name: "robot" as const, icon: <Bot size={14} />, label: "Robot" },
                                {
                                    name: "blob" as const,
                                    icon: <Circle size={14} />,
                                    label: "Blob",
                                },
                                {
                                    name: "crystal" as const,
                                    icon: <Diamond size={14} />,
                                    label: "Crystal",
                                },
                            ].map(({ name, icon, label }) => (
                                <button
                                    key={name}
                                    onClick={() => {
                                        setAvatarVariant(name);
                                        localStorage.setItem("avatar-variant", name);
                                    }}
                                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                                        avatarVariant === name
                                            ? "bg-white/90 text-gray-900 shadow"
                                            : "bg-black/40 text-white/80 hover:bg-black/60"
                                    }`}
                                    aria-label={`${label} avatar`}
                                >
                                    {icon}
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="avatar-page__avatar-actions">
                        <SpaceBetween direction="horizontal" size="s">
                            <Button
                                variant={isRecording ? "normal" : "primary"}
                                onClick={isRecording ? stopRecording : startRecording}
                                disabled={!isConnected}
                                iconSvg={isRecording ? <MicOff size={18} /> : <Mic size={18} />}
                            >
                                {isRecording ? "Stop Recording" : "Start Recording"}
                            </Button>

                            <Button
                                variant="normal"
                                onClick={handleInterrupt}
                                disabled={!isConnected}
                                iconSvg={<HandMetal size={16} />}
                            >
                                Interrupt AI
                                {interruptCount > 0 && (
                                    <span className="avatar-page__interrupt-badge">
                                        {interruptCount}
                                    </span>
                                )}
                            </Button>
                        </SpaceBetween>

                        <p className="avatar-page__avatar-hint">
                            {!isConnected
                                ? "Connect to start a conversation"
                                : isRecording
                                  ? "Listening... speak now"
                                  : "Press to start recording or type below"}
                        </p>

                        <AvatarTextInput onSend={handleSendText} disabled={!isConnected} />
                    </div>
                </div>

                {/* Chat / Transcript column */}
                <div className="avatar-page__chat-col">
                    <div className="avatar-page__chat-header">
                        <h3>Transcript</h3>
                    </div>

                    <div className="avatar-page__transcript" ref={transcriptRef}>
                        {transcript.length === 0 ? (
                            <div className="avatar-page__empty">
                                Your conversation will appear here
                            </div>
                        ) : (
                            <div className="avatar-page__messages">
                                {transcript.map((entry, i) => (
                                    <div
                                        key={i}
                                        className={`avatar-page__bubble avatar-page__bubble--${entry.role}`}
                                    >
                                        <div className="avatar-page__bubble-text">
                                            {entry.segments.map((seg, j) => {
                                                if (seg.kind === "text") {
                                                    return entry.role === "assistant" ? (
                                                        <MarkdownRenderer
                                                            key={j}
                                                            content={seg.content}
                                                        />
                                                    ) : (
                                                        <span key={j}>{seg.content}</span>
                                                    );
                                                }
                                                if (seg.kind === "media") {
                                                    return (
                                                        <div
                                                            key={j}
                                                            className="avatar-page__inline-media"
                                                            onClick={
                                                                seg.mediaType === "image"
                                                                    ? () => setLightboxUrl(seg.url)
                                                                    : undefined
                                                            }
                                                            style={
                                                                seg.mediaType === "image"
                                                                    ? { cursor: "pointer" }
                                                                    : undefined
                                                            }
                                                        >
                                                            {seg.mediaType === "image" ? (
                                                                <img
                                                                    src={seg.url}
                                                                    alt={`Generated by ${seg.toolName}`}
                                                                />
                                                            ) : (
                                                                <video src={seg.url} controls />
                                                            )}
                                                            <span className="avatar-page__media-badge">
                                                                {seg.mediaType === "image" ? (
                                                                    <Image size={12} />
                                                                ) : (
                                                                    <Video size={12} />
                                                                )}
                                                                {seg.toolName}
                                                            </span>
                                                        </div>
                                                    );
                                                }
                                                if (seg.kind === "kb") {
                                                    return (
                                                        <KbSearchResultCard
                                                            key={j}
                                                            name="kb_search"
                                                            args=""
                                                            status="complete"
                                                            result={seg.resultJson}
                                                        />
                                                    );
                                                }
                                                if (seg.kind === "website") {
                                                    return (
                                                        <div key={j} className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-gray-900 to-gray-800 p-4 shadow-lg my-2">
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <span className="text-xl">🌐</span>
                                                                <span className="text-sm font-semibold text-white">{seg.title || "Restaurant Website"}</span>
                                                            </div>
                                                            <a
                                                                href={seg.url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-cyan-500 to-teal-400 text-gray-900 hover:shadow-[0_0_20px_rgba(0,212,255,0.3)] transition-all"
                                                            >
                                                                View Website ↗
                                                            </a>
                                                        </div>
                                                    );
                                                }
                                                if (seg.kind === "tool") {
                                                    return (
                                                        <div
                                                            key={j}
                                                            className="avatar-page__tool-card"
                                                        >
                                                            <Wrench
                                                                size={14}
                                                                className="avatar-page__tool-icon"
                                                            />
                                                            <span className="avatar-page__tool-name">
                                                                {seg.toolName}
                                                            </span>
                                                            <StatusIndicator
                                                                type={
                                                                    seg.status === "running"
                                                                        ? "in-progress"
                                                                        : "success"
                                                                }
                                                            >
                                                                {seg.status === "running"
                                                                    ? "Running"
                                                                    : "Done"}
                                                            </StatusIndicator>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })}
                                        </div>
                                        <span className="avatar-page__bubble-time">
                                            {new Date(entry.timestamp).toLocaleTimeString([], {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            })}
                                        </span>
                                    </div>
                                ))}
                                <div ref={transcriptEndRef} />
                            </div>
                        )}

                        {/* Floating "New messages" button */}
                        {showScrollToBottom && (
                            <div className="avatar-page__new-messages">
                                <Button
                                    variant="primary"
                                    iconSvg={<ChevronDown size={14} />}
                                    onClick={scrollToBottom}
                                >
                                    New messages
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Media results are shown inline in the transcript — no separate sidebar */}
                </div>

                {/* PDF Viewer column (conditionally shown) */}
                {pdfPreview && (
                    <div className="avatar-page__pdf-col">
                        <div className="avatar-page__pdf-header">
                            <h3 className="text-sm font-medium text-gray-700">
                                {pdfPreview.filename || "Document Preview"}
                            </h3>
                            <Button
                                variant="icon"
                                iconName="close"
                                ariaLabel="Close PDF"
                                onClick={() => setPdfPreview(null)}
                            />
                        </div>
                        <div className="avatar-page__pdf-body">
                            <PdfViewer
                                url={pdfPreview.url}
                                title={pdfPreview.filename || "Document"}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* System Prompt Editor Modal */}
            <Modal
                visible={showPromptEditor}
                onDismiss={() => setShowPromptEditor(false)}
                header="System Prompt Editor"
                footer={
                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button onClick={handleResetPrompt} variant="link">
                                Reset to Default
                            </Button>
                            <Button onClick={() => setShowPromptEditor(false)}>Cancel</Button>
                            <Button onClick={handleSavePrompt} variant="primary">
                                Save Prompt
                            </Button>
                        </SpaceBetween>
                    </Box>
                }
            >
                <SpaceBetween direction="vertical" size="s">
                    <Textarea
                        value={systemPrompt}
                        onChange={({ detail }) => setSystemPrompt(detail.value)}
                        placeholder="Enter system prompt here..."
                        rows={8}
                    />
                    <p className="avatar-page__prompt-info">
                        Your system prompt is saved to browser storage and persists across sessions.
                    </p>
                </SpaceBetween>
            </Modal>

            {/* Image lightbox popup */}
            <Modal
                visible={!!lightboxUrl}
                onDismiss={() => setLightboxUrl(null)}
                header="Generated Image"
                size="large"
            >
                {lightboxUrl && (
                    <img
                        src={lightboxUrl}
                        alt="Generated"
                        style={{ width: "100%", height: "auto", borderRadius: 8 }}
                    />
                )}
            </Modal>
        </div>
    );
}
