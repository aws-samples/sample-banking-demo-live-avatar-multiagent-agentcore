import { useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { Avatar3DRobot } from "./Avatar3DRobot";
import { Avatar3DBlob } from "./Avatar3DBlob";
import { Avatar3DCrystal } from "./Avatar3DCrystal";
import type { AvatarVariant, AvatarVariantName, MouthShape } from "./AvatarVariant";

interface Avatar3DReactWrapperProps {
    audioLevel?: number;
    isSpeaking?: boolean;
    isListening?: boolean;
    className?: string;
    variant?: AvatarVariantName;
    mouthShape?: MouthShape;
}

// Single friendly cyan — the previous idle/speaking split (blue → lime-green)
// flashed green every utterance and read as uncanny rather than expressive.
// Speaking cues are now carried by the chest status lights and waveform
// mouth animation instead.
const EYE_COLOR = 0x6cc4ff;

function createAvatar(variant: AvatarVariantName, container: HTMLElement): AvatarVariant {
    switch (variant) {
        case "blob":
            return new Avatar3DBlob(container);
        case "crystal":
            return new Avatar3DCrystal(container);
        // "realistic" never reaches here — AvatarInterface renders
        // TalkingHeadAvatar for it instead of this wrapper.
        case "robot":
        default:
            return new Avatar3DRobot(container);
    }
}

export default function Avatar3DReactWrapper({
    audioLevel = 0,
    isSpeaking = false,
    isListening = false,
    className,
    variant = "robot",
    mouthShape = "neutral",
}: Avatar3DReactWrapperProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const avatarRef = useRef<AvatarVariant | null>(null);
    // WebGL may be unavailable (hardware acceleration disabled, remote desktop,
    // sandboxed GPU). The 3D avatar is presentational only — if it can't
    // initialize we degrade to a static placeholder so the voice conversation
    // (audio + transcript) keeps working instead of crashing the whole page.
    const [webglFailed, setWebglFailed] = useState(false);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let avatar: AvatarVariant;
        try {
            avatar = createAvatar(variant, container);
        } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
                "[Avatar3D] WebGL unavailable — rendering placeholder; voice remains active.",
                err
            );
            setWebglFailed(true);
            return;
        }
        avatarRef.current = avatar;

        // Sync current props into the new avatar instance immediately so it
        // picks up any in-progress speaking/audio state after a variant switch.
        avatar.setSpeaking(isSpeaking);
        avatar.setEyeColor(EYE_COLOR);
        avatar.updateLipSync(isSpeaking ? audioLevel : 0);
        avatar.setMouthShape?.(mouthShape);

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    avatar.resize(width, height);
                }
            }
        });
        observer.observe(container);

        return () => {
            observer.disconnect();
            avatar.dispose();
            avatarRef.current = null;
        };
    }, [variant]);

    // Lip-sync driver — mirrors the 2026 reference implementation. No decay
    // timer: the only signals that can zero the mouth are (a) an actual chunk
    // with audioLevel <= 0, and (b) setSpeaking(false) from the isPlaying mirror
    // below, which calls resetMouth() and zeros jawOpenAmount in Avatar3DRobot.
    // Previously a 400ms decay timer committed updateLipSync(0) whenever PCM
    // chunks paused mid-response (at punctuation / breath gaps), freezing the
    // mouth until the next chunk arrived.
    useEffect(() => {
        const avatar = avatarRef.current;
        if (!avatar) return;
        if (isSpeaking) {
            avatar.updateLipSync(audioLevel);
        } else {
            avatar.updateLipSync(0);
        }
    }, [audioLevel, isSpeaking]);

    // Speaking state mirror — drives setSpeaking on transitions, which in turn
    // zeros jawOpenAmount and calls resetMouth() on false. This is the
    // authoritative "mouth off" signal.
    useEffect(() => {
        avatarRef.current?.setSpeaking?.(isSpeaking);
    }, [isSpeaking]);

    useEffect(() => {
        avatarRef.current?.setMouthShape?.(mouthShape);
    }, [mouthShape]);

    return (
        <div
            ref={containerRef}
            className={`${className ?? ""}${isListening ? " avatar-mic-hot" : ""}`}
            style={{ width: "100%", height: "100%", position: "relative" }}
        >
            {webglFailed && (
                <div
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6"
                    style={{ color: "var(--app-text-secondary)" }}
                >
                    <div
                        className={`flex items-center justify-center rounded-full p-6${isSpeaking ? " animate-pulse" : ""}`}
                        style={{
                            background: "var(--glass-bg)",
                            border: "1px solid var(--glass-border)",
                        }}
                    >
                        <Bot size={48} style={{ color: "var(--brand-accent, #c8a24a)" }} />
                    </div>
                    <div className="text-sm font-medium">
                        {isSpeaking ? "Speaking…" : isListening ? "Listening…" : "Voice ready"}
                    </div>
                    <div className="text-xs opacity-70 max-w-xs">
                        The 3D avatar needs WebGL, which is disabled in this browser. Voice and
                        transcript are fully active — enable hardware acceleration to see the
                        avatar.
                    </div>
                </div>
            )}
        </div>
    );
}
