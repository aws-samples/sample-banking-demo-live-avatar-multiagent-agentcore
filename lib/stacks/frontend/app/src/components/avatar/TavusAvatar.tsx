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
    className?: string;
}

// If a video track has not arrived within this window after mount, surface a
// hint rather than holding the "Connecting…" state forever.
const TRACK_TIMEOUT_MS = 20_000;

export default function TavusAvatar({
    videoTrack = null,
    isSpeaking = false,
    className,
}: TavusAvatarProps): JSX.Element {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [timedOut, setTimedOut] = useState(false);
    // Whether the avatar video is present is derived from the track, not stored
    // as state — avoids a synchronous setState in the attach effect.
    const hasVideo = !!videoTrack;

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

    // Track-arrival timeout — armed only while there is no video track. The
    // state is set from the timer callback (not synchronously in the effect).
    useEffect(() => {
        if (videoTrack) return;
        const timer = setTimeout(() => setTimedOut(true), TRACK_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [videoTrack]);

    return (
        <div className={className} style={{ width: "100%", height: "100%", position: "relative" }}>
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
            {!hasVideo && (
                <div
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6 pointer-events-none"
                    style={{ color: "var(--app-text-secondary)" }}
                >
                    <div
                        className="flex items-center justify-center rounded-full p-6 animate-pulse"
                        style={{
                            background: "var(--glass-bg)",
                            border: "1px solid var(--glass-border)",
                        }}
                    >
                        <Video size={48} style={{ color: "var(--brand-accent, #c8a24a)" }} />
                    </div>
                    <div className="text-sm font-medium">
                        {timedOut ? "Avatar unavailable" : "Connecting avatar…"}
                    </div>
                    <div className="text-xs opacity-70 max-w-xs">
                        {timedOut
                            ? "The video avatar did not start. Voice and transcript may still work — try another avatar or reconnect."
                            : "Starting the live video avatar. Voice begins once it connects."}
                    </div>
                </div>
            )}
        </div>
    );
}
