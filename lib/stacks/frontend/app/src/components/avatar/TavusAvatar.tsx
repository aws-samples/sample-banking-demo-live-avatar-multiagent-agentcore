/**
 * Server-rendered photoreal video avatar — the "Realistic" variant.
 *
 * Unlike the other variants, nothing is rendered locally: the avatar is produced
 * by Tavus and delivered as a live WebRTC video track by the Pipecat worker (see
 * the tavus-avatar-integration spec). This component just attaches that track to
 * a <video> element. It has no WebGL dependency, so it renders wherever a plain
 * video does.
 *
 * Audio is played by the transport client (a hidden <audio> element), so the
 * <video> here is muted to avoid double-playing the agent's voice.
 */

import { useEffect, useRef, useState } from "react";
import { Video } from "lucide-react";

export interface TavusAvatarProps {
    /** Remote avatar video track from the Pipecat worker (via Daily). */
    videoTrack?: MediaStreamTrack | null;
    /** Whether the agent is currently speaking, for a subtle speaking ring. */
    isSpeaking?: boolean;
    /**
     * Transport connection state. Before Connect (disconnected) the avatar is
     * idle — no face is rendered or fetched — so the placeholder must say so
     * rather than claim it is "connecting" or "unavailable".
     */
    connectionState?: string;
    className?: string;
}

// If a video track has not arrived within this window AFTER connecting, surface
// a hint rather than holding the "Connecting…" state forever. Only armed while
// connecting/connected — never while idle (disconnected).
const TRACK_TIMEOUT_MS = 20_000;

// AWS-branded backdrop for the Realistic avatar stage, matching the reference
// app (gartner-ai-appdev-platforms-avatar-tavus): a deep-navy base with an
// AWS-blue glow at the top and an AWS-green glow at the bottom. Shown behind the
// pre-connect placeholder and as the stage around the live video.
const AWS_BRANDED_BACKGROUND =
    "radial-gradient(circle at top, rgba(41, 80, 200, 0.35), transparent 38%)," +
    "linear-gradient(120deg, rgba(255, 255, 255, 0.04), transparent 38%)," +
    "radial-gradient(circle at bottom, rgba(123, 204, 163, 0.2), transparent 35%)," +
    "linear-gradient(180deg, #09101d 0%, #060912 100%)";

export default function TavusAvatar({
    videoTrack = null,
    isSpeaking = false,
    connectionState = "disconnected",
    className,
}: TavusAvatarProps): JSX.Element {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [timedOut, setTimedOut] = useState(false);
    // Whether the avatar video is present is derived from the track, not stored
    // as state — avoids a synchronous setState in the attach effect.
    const hasVideo = !!videoTrack;
    // The session is live (or coming up) only once Connect has been pressed.
    const isActive = connectionState === "connecting" || connectionState === "connected";

    // Attach / detach the remote video track.
    useEffect(() => {
        const el = videoRef.current;
        if (!el) return;
        if (videoTrack) {
            el.srcObject = new MediaStream([videoTrack]);
            void el.play().catch(() => {
                /* autoplay may defer until a gesture; the user has clicked Connect */
            });
        } else {
            el.srcObject = null;
        }
    }, [videoTrack]);

    // Track-arrival timeout — armed only once connecting/connected and while
    // there is no video track yet. Never armed while idle (disconnected), so a
    // never-connected avatar does not falsely read as "unavailable".
    useEffect(() => {
        if (videoTrack || !isActive) {
            setTimedOut(false);
            return;
        }
        const timer = setTimeout(() => setTimedOut(true), TRACK_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [videoTrack, isActive]);

    return (
        <div
            className={className}
            style={{
                width: "100%",
                height: "100%",
                position: "relative",
                background: AWS_BRANDED_BACKGROUND,
            }}
        >
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: hasVideo ? "block" : "none",
                    outline: isSpeaking ? "3px solid var(--brand-accent, #c8a24a)" : "none",
                    outlineOffset: "-3px",
                    transition: "outline-color 150ms ease",
                }}
            />
            {!hasVideo &&
                (() => {
                    // Three distinct states so the placeholder never misleads:
                    //   idle (pre-Connect) — nothing is rendered or fetched yet
                    //   connecting/connected without a track — coming up
                    //   timed out / error — it did not start
                    const failed = timedOut || connectionState === "error";
                    const heading = !isActive
                        ? "Realistic avatar"
                        : failed
                          ? "Avatar unavailable"
                          : "Connecting avatar…";
                    const detail = !isActive
                        ? "Press Connect to start the live video avatar. The realistic face appears here once the session connects."
                        : failed
                          ? "The video avatar did not start. Voice and transcript may still work — try another avatar or reconnect."
                          : "Starting the live video avatar. Voice begins once it connects.";
                    // Pulse only while actively coming up, not when idle or failed.
                    const pulse = isActive && !failed;
                    return (
                        <div
                            className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6 pointer-events-none"
                            style={{ color: "var(--app-text-secondary)" }}
                        >
                            <div
                                className={`flex items-center justify-center rounded-full p-6${pulse ? " animate-pulse" : ""}`}
                                style={{
                                    background: "var(--glass-bg)",
                                    border: "1px solid var(--glass-border)",
                                }}
                            >
                                <Video
                                    size={48}
                                    style={{ color: "var(--brand-accent, #c8a24a)" }}
                                />
                            </div>
                            <div className="text-sm font-medium">{heading}</div>
                            <div className="text-xs opacity-70 max-w-xs">{detail}</div>
                        </div>
                    );
                })()}
        </div>
    );
}
