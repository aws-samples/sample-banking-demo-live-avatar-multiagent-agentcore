import { useEffect, useRef } from "react";
import { Avatar3DRobot } from "./Avatar3DRobot";
import { Avatar3DBlob } from "./Avatar3DBlob";
import { Avatar3DCrystal } from "./Avatar3DCrystal";
import type { AvatarVariant, AvatarVariantName, QualityTier } from "./AvatarVariant";

interface Avatar3DReactWrapperProps {
    audioLevel?: number;
    isSpeaking?: boolean;
    isListening?: boolean;
    className?: string;
    variant?: AvatarVariantName;
    quality?: QualityTier;
}

const EYE_COLOR_IDLE = 0x4488ff;
const EYE_COLOR_SPEAKING = 0x00ff88;

function createAvatar(variant: AvatarVariantName, container: HTMLElement): AvatarVariant {
    switch (variant) {
        case "blob":
            return new Avatar3DBlob(container);
        case "crystal":
            return new Avatar3DCrystal(container);
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
    quality = "medium",
}: Avatar3DReactWrapperProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const avatarRef = useRef<AvatarVariant | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const avatar = createAvatar(variant, container);
        avatarRef.current = avatar;

        // Sync current props into the new avatar instance immediately so it
        // picks up any in-progress speaking/audio state after a variant switch.
        avatar.setSpeaking(isSpeaking);
        avatar.setEyeColor(isSpeaking ? EYE_COLOR_SPEAKING : EYE_COLOR_IDLE);
        avatar.updateLipSync(isSpeaking ? audioLevel : 0);
        avatar.setQuality?.(quality);

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

    useEffect(() => {
        const avatar = avatarRef.current;
        if (!avatar) return;

        if (isSpeaking) {
            avatar.updateLipSync(audioLevel);
        } else {
            avatar.updateLipSync(0);
        }
    }, [audioLevel, isSpeaking]);

    useEffect(() => {
        const avatar = avatarRef.current;
        if (!avatar) return;

        avatar.setSpeaking(isSpeaking);

        if (isSpeaking) {
            avatar.setEyeColor(EYE_COLOR_SPEAKING);
        } else {
            avatar.setEyeColor(EYE_COLOR_IDLE);
        }
    }, [isSpeaking, isListening]);

    useEffect(() => {
        avatarRef.current?.setQuality?.(quality);
    }, [quality]);

    return (
        <div
            ref={containerRef}
            className={`${className ?? ""}${isListening ? " avatar-mic-hot" : ""}`}
            style={{ width: "100%", height: "100%" }}
        />
    );
}
