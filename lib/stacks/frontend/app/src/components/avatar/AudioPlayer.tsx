import { useRef, useCallback, useEffect, useState } from "react";
import { pcmBase64ToAudioBuffer, OUTPUT_SAMPLE_RATE } from "@/lib/websocket-client/audio-utils";
import { Volume2, VolumeX } from "lucide-react";

/**
 * AudioPlayer manages AudioContext-based PCM playback with queue management
 * for streamed audio chunks from the avatar WebSocket.
 */
export function useAudioPlayer() {
    const audioContextRef = useRef<AudioContext | null>(null);
    const queueRef = useRef<AudioBuffer[]>([]);
    const isPlayingRef = useRef(false);
    const nextStartTimeRef = useRef(0);
    const gainNodeRef = useRef<GainNode | null>(null);
    const [volume, setVolume] = useState(1.0);
    const [isMuted, setIsMuted] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);

    const getAudioContext = useCallback((): AudioContext => {
        if (!audioContextRef.current || audioContextRef.current.state === "closed") {
            audioContextRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
            gainNodeRef.current = audioContextRef.current.createGain();
            gainNodeRef.current.connect(audioContextRef.current.destination);
            gainNodeRef.current.gain.value = isMuted ? 0 : volume;
        }
        if (audioContextRef.current.state === "suspended") {
            audioContextRef.current.resume();
        }
        return audioContextRef.current;
    }, [volume, isMuted]);

    const playNext = useCallback((): void => {
        const ctx = audioContextRef.current;
        const gain = gainNodeRef.current;
        if (!ctx || !gain || queueRef.current.length === 0) {
            isPlayingRef.current = false;
            setIsPlaying(false);
            return;
        }

        isPlayingRef.current = true;
        setIsPlaying(true);

        const buffer = queueRef.current.shift()!;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);

        const startTime = Math.max(ctx.currentTime, nextStartTimeRef.current);
        source.start(startTime);
        nextStartTimeRef.current = startTime + buffer.duration;

        source.onended = () => {
            if (queueRef.current.length > 0) {
                playNext();
            } else {
                isPlayingRef.current = false;
                nextStartTimeRef.current = 0;
                setIsPlaying(false);
            }
        };
    }, []);

    const enqueueAudio = useCallback(
        (base64Audio: string): void => {
            try {
                const ctx = getAudioContext();
                const audioBuffer = pcmBase64ToAudioBuffer(base64Audio, ctx);
                queueRef.current.push(audioBuffer);

                if (!isPlayingRef.current) {
                    playNext();
                }
            } catch (err) {
                console.error("Failed to enqueue audio:", err);
            }
        },
        [getAudioContext, playNext]
    );

    const clearQueue = useCallback((): void => {
        queueRef.current = [];
        nextStartTimeRef.current = 0;
        isPlayingRef.current = false;
        setIsPlaying(false);
    }, []);

    const updateVolume = useCallback(
        (newVolume: number): void => {
            setVolume(newVolume);
            if (gainNodeRef.current) {
                gainNodeRef.current.gain.value = isMuted ? 0 : newVolume;
            }
        },
        [isMuted]
    );

    const toggleMute = useCallback((): void => {
        setIsMuted((prev) => {
            const next = !prev;
            if (gainNodeRef.current) {
                gainNodeRef.current.gain.value = next ? 0 : volume;
            }
            return next;
        });
    }, [volume]);

    useEffect(() => {
        return () => {
            clearQueue();
            if (audioContextRef.current && audioContextRef.current.state !== "closed") {
                audioContextRef.current.close();
            }
        };
    }, [clearQueue]);

    return {
        enqueueAudio,
        clearQueue,
        isPlaying,
        volume,
        setVolume: updateVolume,
        isMuted,
        toggleMute,
    };
}

interface AudioPlayerControlsProps {
    volume: number;
    setVolume: (volume: number) => void;
    isMuted: boolean;
    toggleMute: () => void;
}

export function AudioPlayerControls({
    volume,
    setVolume,
    isMuted,
    toggleMute,
}: AudioPlayerControlsProps): JSX.Element {
    return (
        <div className="flex items-center gap-2">
            <button
                onClick={toggleMute}
                className="p-1.5 rounded-md hover:bg-gray-100 transition-colors text-gray-600"
                aria-label={isMuted ? "Unmute" : "Mute"}
            >
                {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-20 h-1 accent-gray-800"
                aria-label="Volume"
            />
        </div>
    );
}
