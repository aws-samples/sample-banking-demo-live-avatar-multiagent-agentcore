import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    Camera,
    Circle,
    Diamond,
    UserRound,
} from "lucide-react";
import type { AvatarVariantName, MouthShape } from "./AvatarVariant";
import { VARIANT_VOICE_GENDER } from "./AvatarVariant";
import { analyzeChunk, resetAnalyzer } from "./lipSyncAnalyzer";
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
import KbPipelineChips from "./KbPipelineChips";
import { useAvatarKbPipelinesStore } from "@/stores/avatarKbPipelinesStore";
import ResizablePanelLayout, {
    type ResizablePanelConfig,
} from "@/components/common/resizable/ResizablePanelLayout";
import Avatar3DReactWrapper from "./Avatar3DReactWrapper";
import TalkingHeadAvatar from "./TalkingHeadAvatar";
import WebsiteMonitor from "./WebsiteMonitor";
import { useAudioPlayer, AudioPlayerControls } from "./AudioPlayer";
import { MarkdownRenderer } from "../chat/MarkdownRenderer";
import { KbSearchResultCard } from "../chat/KbSearchResultCard";
import PdfViewer from "../viewer/PdfViewer";
import {
    AvatarWebSocketClient,
    type AvatarWSMessage,
    type ConnectionState,
    type KbPipeline,
    type PersonaId,
} from "@/lib/websocket-client/client";
import {
    type LanguageCode,
    getDefaultVoice,
    getVoiceForGender,
    getVoicesForLanguage,
    VOICES,
} from "@/lib/websocket-client/voice-config";
import { presignAgentCoreWebSocket } from "@/lib/websocket-client/sigv4";
import { AvatarLiveKitClient } from "@/lib/livekit-client/avatarLiveKitClient";
import type { TranscriptUpdate, ToolActivity } from "@/lib/livekit-client/avatarLiveKitClient";
import { extractToolArtifacts } from "./toolArtifacts";
import { getAWSCredentials } from "@/lib/auth/credentials";
import { createPCMProcessorUrl, arrayBufferToBase64 } from "@/lib/websocket-client/audio-utils";
import AvatarTextInput from "./AvatarTextInput";
import AvatarSuggestedPrompts from "./AvatarSuggestedPrompts";
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
    /**
     * Identifies an entry that is still being written to, so streamed text
     * updates the bubble it belongs to instead of appending a new one. Set on
     * the LiveKit path, where transcripts arrive as growing streams keyed by
     * utterance; the WebSocket path tracks its in-progress text through refs
     * instead and leaves this undefined.
     */
    streamId?: string;
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
    /** Set once the user picks a voice, after which the avatar stops overriding it. */
    const [voicePinned, setVoicePinned] = useState(false);

    // Avatar KB pipeline multi-select state (persisted via Zustand/localStorage).
    const kbPipelines = useAvatarKbPipelinesStore((s) => s.pipelines);

    const [isRecording, setIsRecording] = useState(false);
    const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
    const [mediaResults, setMediaResults] = useState<ToolResultMedia[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [audioLevel, setAudioLevel] = useState(0);
    const [visemeShape, setVisemeShape] = useState<MouthShape>("neutral");
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
    // Default to the photorealistic advisor. The key is versioned (-v2) so
    // existing sessions that had "robot" saved still pick up the new default.
    const [avatarVariant, setAvatarVariant] = useState<AvatarVariantName>(() => {
        return (localStorage.getItem("avatar-variant-v2") as AvatarVariantName) || "realistic";
    });

    // --- Smart auto-scroll state ---
    const [isUserScrolling, setIsUserScrolling] = useState(false);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastMessageCountRef = useRef(0);

    // --- LiveKit (WebRTC) transport — gated behind VITE_LIVEKIT_TOKEN_URL.
    // When set, the avatar uses LiveKit instead of the AgentCore WebSocket
    // + SigV4 + mic AudioWorklet path. When absent, behavior is unchanged.
    const liveKitTokenUrl = import.meta.env.VITE_LIVEKIT_TOKEN_URL;
    const [liveKitSpeaking, setLiveKitSpeaking] = useState(false);
    // Raw agent audio track — fed to the photorealistic avatar so it can run
    // MFCC-based viseme detection on the signal itself.
    const [agentAudioTrack, setAgentAudioTrack] = useState<MediaStreamTrack | null>(null);

    // --- Refs ---
    const wsClientRef = useRef<AvatarWebSocketClient | null>(null);
    const liveKitClientRef = useRef<AvatarLiveKitClient | null>(null);
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

    // --- Reset audioLevel when playback stops (debounced) ---
    // Previously: instantly zeroed audioLevel + reset analyzer whenever `isPlaying`
    // bobbled false, which happens between every pair of utterances (AudioContext
    // suspend/resume race). Now: wait 800 ms of continuous !isPlaying before
    // committing, so brief inter-utterance silences don't kill the mouth. Also
    // dropped the resetAnalyzer() call — wiping smoothing state mid-session made
    // each new sentence start under-amplitude.
    useEffect(() => {
        if (isPlaying) return;
        const timer = setTimeout(() => {
            setAudioLevel(0);
            setVisemeShape("neutral");
        }, 800);
        return () => clearTimeout(timer);
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
        // An explicit choice wins from here on: stop matching the voice to the
        // avatar, or switching avatars would silently discard the user's pick.
        setVoicePinned(true);
        wsClientRef.current?.updateVoice(newVoiceId);
    }, []);

    // --- Keep the voice matching the avatar on screen ---
    // "Advisor" is a female GLB and "Realistic" is a male photograph, so the
    // voice follows the face unless the user has chosen one themselves. Without
    // this the default female avatar spoke with a male voice, which reads as a
    // bug rather than a choice.
    const handleVariantChange = useCallback(
        (name: AvatarVariantName): void => {
            setAvatarVariant(name);
            localStorage.setItem("avatar-variant-v2", name);

            if (voicePinned) return;
            const gender = VARIANT_VOICE_GENDER[name];
            if (!gender) return;
            const next = getVoiceForGender(language, gender).id;
            if (next === voiceId) return;
            setVoiceId(next);
            wsClientRef.current?.updateVoice(next);
        },
        [language, voiceId, voicePinned]
    );

    // --- LiveKit transcript + tool activity ---
    // Nova Sonic is speech-to-speech, so without these the transcript panel
    // stayed empty for the whole conversation and anything a tool produced — a
    // website link, a generated image — was spoken about but never shown.

    /** Update the bubble for this utterance, or start one if it is new. */
    const handleLiveKitTranscript = useCallback(
        // `isFinal` is deliberately ignored: the bubble keeps its key for the
        // life of the utterance. The agent's speech arrives as one delta stream
        // that is closed at the end, while a transcribed voice arrives as
        // successive streams that each carry the latest full text under the same
        // segment id. Retiring the key on the first completion left that second
        // stream with no bubble to update, so it appended and the sentence
        // showed twice.
        ({ segmentId, role, text }: TranscriptUpdate): void => {
            setTranscript((prev) => {
                const idx = prev.findIndex((e) => e.streamId === segmentId);
                if (idx === -1) {
                    return [
                        ...prev,
                        {
                            role,
                            segments: [{ kind: "text", content: text }],
                            timestamp: new Date().toISOString(),
                            streamId: segmentId,
                        },
                    ];
                }
                const updated = [...prev];
                updated[idx] = {
                    ...updated[idx],
                    segments: [{ kind: "text", content: text }],
                };
                return updated;
            });
        },
        []
    );

    /** Show a tool card while it runs, then whatever it produced. */
    const handleLiveKitToolActivity = useCallback((activity: ToolActivity): void => {
        const { callId, name, status, output } = activity;
        const cardId = `tool-${callId}`;

        setTranscript((prev) => {
            const idx = prev.findIndex((e) => e.streamId === cardId);
            const card: TranscriptEntry = {
                role: "assistant",
                segments: [
                    {
                        kind: "tool",
                        toolName: name,
                        status: status === "running" ? "running" : "done",
                    },
                ],
                timestamp: new Date().toISOString(),
                // Kept after completion so a late-arriving duplicate updates the
                // same card rather than adding a second one.
                streamId: cardId,
            };
            const next = idx === -1 ? [...prev, card] : [...prev];
            if (idx !== -1) next[idx] = { ...next[idx], ...card };

            if (status === "running" || !output) return next;

            // Anything the tool produced becomes its own entry below the card,
            // reusing the segment kinds the panel already renders.
            for (const artifact of extractToolArtifacts(name, output)) {
                next.push({
                    role: "assistant",
                    segments: [artifact],
                    timestamp: new Date().toISOString(),
                });
            }
            return next;
        });

        if (status !== "done" || !output) return;

        // Side panels mirror what the WebSocket path does for the same results.
        for (const artifact of extractToolArtifacts(name, output)) {
            if (artifact.kind === "website") {
                if (name.includes("pdf_generator")) {
                    setPdfPreview({ url: artifact.url, filename: artifact.title });
                } else {
                    setWebsitePreview(artifact.url);
                }
            } else if (artifact.kind === "media") {
                setMediaResults((prev) => [
                    ...prev,
                    {
                        type: artifact.mediaType,
                        url: artifact.url,
                        toolName: name,
                        timestamp: new Date().toISOString(),
                    },
                ]);
            }
        }
    }, []);

    // --- WebSocket message handler ---
    const handleWSMessage = useCallback(
        (message: AvatarWSMessage): void => {
            switch (message.type) {
                case "audio":
                    if (message.audioData) {
                        enqueueAudio(message.audioData);
                        const { rms, shape } = analyzeChunk(message.audioData);
                        setAudioLevel(rms);
                        setVisemeShape(shape);
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
                            const cleaned = textToAppend
                                .replace(/https?:\/\/\S+/g, "")
                                .replace(/\s{2,}/g, " ");
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
                                try {
                                    wr = JSON.parse(wr.content[0].text);
                                } catch {
                                    /* not nested */
                                }
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
                        } catch {
                            /* not JSON */
                        }
                    }

                    currentAssistantTextRef.current = "";
                    break;

                case "sessionStart":
                    setError(null);
                    break;

                case "sessionEnd":
                    setConnectionState("disconnected");
                    setAudioLevel(0);
                    setVisemeShape("neutral");
                    resetAnalyzer();
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
            if (connectionState !== "connected") return;

            // On LiveKit the agent accepts typed input on its own channel. This
            // used to return early because it only checked for a WebSocket
            // client, so on that transport the input box and the suggested
            // prompts silently did nothing.
            const lkClient = liveKitTokenUrl ? liveKitClientRef.current : null;
            if (!lkClient && !wsClientRef.current) return;

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

            if (lkClient) {
                void lkClient.sendText(text);
            } else {
                wsClientRef.current?.sendText(text);
            }
        },
        [connectionState, liveKitTokenUrl]
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

        // --- LiveKit (WebRTC) path ---
        if (liveKitTokenUrl) {
            if (!auth.user?.id_token) {
                setError("Avatar connection requires a Cognito id_token — check authentication.");
                return;
            }
            const lkClient = new AvatarLiveKitClient({
                idToken: auth.user.id_token,
                onAudioLevel: setAudioLevel,
                onSpeakingChange: setLiveKitSpeaking,
                onConnectionState: setConnectionState,
                onAudioTrack: setAgentAudioTrack,
                onTranscript: handleLiveKitTranscript,
                onToolActivity: handleLiveKitToolActivity,
                onError: (err) => setError(`LiveKit error: ${err.message}`),
            });
            liveKitClientRef.current = lkClient;
            try {
                await lkClient.connect();
                // LiveKit publishes the mic on connect — reflect that in the UI.
                setIsRecording(true);
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Unknown error";
                console.error(`[AvatarInterface] LiveKit connection failed: ${msg}`);
                setError(`Failed to establish avatar connection: ${msg}`);
            }
            return;
        }

        // AgentCore Runtime WebSocket endpoints only honor SigV4 or
        // OAuth Bearer (in the Authorization header). Browsers cannot
        // set arbitrary WebSocket headers, so SigV4 presigned URL is
        // the only viable path — hence Identity Pool + id_token are
        // required.
        if (!config.identityPoolId || !config.cognitoUserPoolId || !auth.user.id_token) {
            setError(
                "Avatar connection requires a Cognito Identity Pool and id_token — check deployment config."
            );
            return;
        }

        const client = new AvatarWebSocketClient(
            {
                runtimeArn: config.avatarRuntimeArn,
                region: config.awsRegion,
                sessionId: sessionIdRef.current,
                persona,
                language,
                voiceId,
                kbPipelines,
                idToken: auth.user.id_token,
            },
            handleWSMessage,
            setConnectionState
        );

        wsClientRef.current = client;

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
                {
                    persona,
                    language,
                    voiceId,
                    kbPipelines,
                }
            );
            console.log("[AvatarInterface] Connecting with SigV4 presigned URL");
            client.connect(presignedUrl);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            console.error(`[AvatarInterface] SigV4 presigning failed: ${msg}`);
            setError(`Failed to establish avatar connection: ${msg}`);
        }
    }, [
        config,
        auth.user,
        persona,
        language,
        voiceId,
        kbPipelines,
        handleWSMessage,
        clearQueue,
        liveKitTokenUrl,
        handleLiveKitTranscript,
        handleLiveKitToolActivity,
    ]);

    // --- Recording ---
    const stopRecording = useCallback((): void => {
        // LiveKit path: just mute the published mic; the AudioWorklet below
        // is never set up on this transport.
        if (liveKitTokenUrl) {
            void liveKitClientRef.current?.setMicrophoneEnabled(false);
            setIsRecording(false);
            return;
        }
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
    }, [liveKitTokenUrl]);

    const disconnect = useCallback((): void => {
        // LiveKit path: tear down the room + audio analysis and reset UI.
        if (liveKitTokenUrl) {
            liveKitClientRef.current?.disconnect();
            liveKitClientRef.current = null;
            setIsRecording(false);
            setLiveKitSpeaking(false);
            setAgentAudioTrack(null);
            setAudioLevel(0);
            setVisemeShape("neutral");
            return;
        }
        stopRecording();
        wsClientRef.current?.disconnect();
        wsClientRef.current = null;
        clearQueue();
        setAudioLevel(0);
        setVisemeShape("neutral");
        resetAnalyzer();
    }, [clearQueue, stopRecording, liveKitTokenUrl]);

    const startRecording = useCallback(async (): Promise<void> => {
        // LiveKit path: the mic is published on connect; re-enable it here.
        if (liveKitTokenUrl) {
            if (connectionState !== "connected") return;
            await liveKitClientRef.current?.setMicrophoneEnabled(true);
            setIsRecording(true);
            return;
        }

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
    }, [connectionState, liveKitTokenUrl]);

    // --- Persona change ---
    const handlePersonaChange = useCallback((newPersona: PersonaId): void => {
        setPersona(newPersona);
        wsClientRef.current?.updatePersona(newPersona);
    }, []);

    // --- KB pipelines change (mid-session multi-select from chip bar) ---
    const handleKbPipelinesChange = useCallback((next: KbPipeline[]): void => {
        // Store is already updated by the chip component; forward to backend
        // so the PipelineScopeHook picks up the new scope on the next kb_search.
        wsClientRef.current?.updateKbPipelines(next);
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
        setVisemeShape("neutral");
        resetAnalyzer();
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

    // Panel configs for the avatar-page main area. The PDF column is only
    // included when pdfPreview is present; react-resizable-panels handles the
    // re-layout via the useDefaultLayout hook (widths persist to localStorage).
    const avatarPanels = useMemo(() => {
        // Default split: avatar canvas claims the left half of the screen.
        // minSize is set to 40 so a stray drag can't squeeze the canvas into
        // a thin strip on 4K displays where the transcript column has lots
        // of room to expand into.
        const configs: ResizablePanelConfig[] = [
            { id: "avatar-canvas", defaultSize: 50, minSize: 40 },
            { id: "avatar-transcript", defaultSize: 50, minSize: 25 },
        ];
        if (pdfPreview) {
            configs[0].defaultSize = 40;
            configs[0].minSize = 30;
            configs[1].defaultSize = 30;
            configs.push({ id: "avatar-pdf", defaultSize: 30, minSize: 20 });
        }
        const total = configs.reduce((s, c) => s + c.defaultSize, 0);
        return configs.map((c) => ({ ...c, defaultSize: (c.defaultSize / total) * 100 }));
    }, [pdfPreview]);

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

            {/* KB pipeline multi-select (applies to voice avatar kb_search calls) */}
            <div
                className="px-4 py-2 flex items-center"
                style={{ borderBottom: "1px solid var(--glass-border)" }}
            >
                <KbPipelineChips onChange={handleKbPipelinesChange} />
            </div>

            {/* Error banner */}
            {error && (
                <div className="avatar-page__error">
                    <Alert type="error" dismissible onDismiss={() => setError(null)}>
                        {error}
                    </Alert>
                </div>
            )}

            {/* Main content grid — panels are user-resizable (widths persist to localStorage).
                The PDF column is conditionally rendered; its panel config is only included when present. */}
            <ResizablePanelLayout
                // Bump the save id to invalidate old (narrow) layouts saved
                // before the 50/50 default — on 4K screens the prior saved
                // widths left the avatar canvas cramped.
                autoSaveId="avatar-v2"
                direction="horizontal"
                panels={avatarPanels}
                className="avatar-page__main"
            >
                {/* Avatar column */}
                <div className="avatar-page__avatar-col">
                    <div className="avatar-page__avatar-header">
                        <h2>Virtual Assistant</h2>
                        <p>AI Avatar with real-time voice interaction</p>
                    </div>

                    <div className="avatar-page__avatar-canvas">
                        {avatarVariant === "realistic" ? (
                            <TalkingHeadAvatar
                                audioTrack={agentAudioTrack}
                                audioLevel={audioLevel}
                                isSpeaking={liveKitTokenUrl ? liveKitSpeaking : isPlaying}
                                className="w-full h-full"
                            />
                        ) : (
                            <Avatar3DReactWrapper
                                audioLevel={audioLevel}
                                isSpeaking={liveKitTokenUrl ? liveKitSpeaking : isPlaying}
                                isListening={isRecording}
                                className="w-full h-full"
                                variant={avatarVariant}
                                mouthShape={visemeShape}
                                audioTrack={agentAudioTrack}
                            />
                        )}

                        {/* Draggable website monitor overlay */}
                        {websitePreview && (
                            <WebsiteMonitor
                                url={websitePreview}
                                onClose={() => setWebsitePreview(null)}
                            />
                        )}
                        <div className="absolute bottom-2 left-2 flex gap-1">
                            {[
                                {
                                    name: "realistic" as const,
                                    icon: <UserRound size={14} />,
                                    label: "Advisor",
                                },
                                {
                                    name: "photo" as const,
                                    icon: <Camera size={14} />,
                                    label: "Realistic",
                                },
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
                                    onClick={() => handleVariantChange(name)}
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
                                <AvatarSuggestedPrompts
                                    onSelect={handleSendText}
                                    disabled={!isConnected}
                                />
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
                                                        <div
                                                            key={j}
                                                            className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-gray-900 to-gray-800 p-4 shadow-lg my-2"
                                                        >
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <span className="text-xl">🌐</span>
                                                                <span className="text-sm font-semibold text-white">
                                                                    {seg.title || "Banking Website"}
                                                                </span>
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
            </ResizablePanelLayout>

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
