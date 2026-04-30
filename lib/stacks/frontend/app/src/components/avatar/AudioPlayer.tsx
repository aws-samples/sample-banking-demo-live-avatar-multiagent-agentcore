import { useRef, useCallback, useEffect, useState } from "react";
import { pcmBase64ToAudioBuffer, OUTPUT_SAMPLE_RATE } from "@/lib/websocket-client/audio-utils";
import { Volume2, VolumeX } from "lucide-react";

/**
 * Scheduling lookahead for PCM chunk playback.
 *
 * The previous implementation used `Math.max(ctx.currentTime, nextStartTime)`
 * with zero slack — if a chunk arrived even one audio-callback late, the
 * scheduler would jump start-time forward and a tiny gap would cause an
 * audible click. 40 ms is enough headroom to absorb normal GC / network
 * jitter without introducing perceptible latency.
 */
const SCHEDULING_LOOKAHEAD_SECONDS = 0.04;

/**
 * Crossfade applied at the head and tail of every chunk to prevent clicks
 * at PCM-chunk boundaries. Nova Sonic's output chunks are not guaranteed to
 * align on zero-crossings; a 2 ms gain ramp is below the threshold of
 * perceptible envelope modulation on speech while completely killing the
 * step-discontinuity click.
 */
const CHUNK_FADE_SECONDS = 0.002;

/**
 * AudioPlayer manages AudioContext-based PCM playback with queue management
 * for streamed audio chunks from the avatar WebSocket.
 *
 * Key design decisions to avoid scratchy audio:
 *  1. AudioContext is created at OUTPUT_SAMPLE_RATE (24 kHz) so that each
 *     24 kHz AudioBuffer plays sample-exact — no per-buffer resampling.
 *  2. Every chunk is scheduled immediately at `nextStartTime` on enqueue,
 *     not chained via `onended`. onended callbacks are event-loop gated
 *     and stall under backpressure; start-time chaining keeps the audio
 *     thread fed directly from its own clock.
 *  3. A 40 ms scheduling lookahead keeps at least one chunk queued ahead
 *     of `ctx.currentTime` so normal jitter can't cause the scheduler to
 *     fall behind and emit silence-then-jump.
 *  4. Each chunk is wrapped in a 2 ms linear-ramp GainNode envelope to
 *     mask the tiny step-discontinuity between non-zero-crossing PCM
 *     chunks.
 */
export function useAudioPlayer() {
    const audioContextRef = useRef<AudioContext | null>(null);
    const queuedCountRef = useRef(0);
    const nextStartTimeRef = useRef(0);
    const gainNodeRef = useRef<GainNode | null>(null);
    const [volume, setVolume] = useState(1.0);
    const [isMuted, setIsMuted] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);

    const getAudioContext = useCallback((): AudioContext => {
        if (!audioContextRef.current || audioContextRef.current.state === "closed") {
            // Match the stream's native rate exactly. Without this, Chrome/
            // Safari resample each AudioBuffer with a cheap per-buffer linear
            // interpolator which is the single largest source of "scratch".
            // A handful of older mobile browsers refuse non-native rates —
            // fall back to the default rate in that case (still better than
            // crashing; the per-buffer resample path at least works).
            try {
                audioContextRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
            } catch (err) {
                console.warn(
                    `[AudioPlayer] Could not open ${OUTPUT_SAMPLE_RATE}Hz AudioContext, ` +
                        `falling back to default rate. Expect mild quality degradation.`,
                    err
                );
                audioContextRef.current = new AudioContext();
            }
            gainNodeRef.current = audioContextRef.current.createGain();
            gainNodeRef.current.connect(audioContextRef.current.destination);
            gainNodeRef.current.gain.value = isMuted ? 0 : volume;
        }
        if (audioContextRef.current.state === "suspended") {
            audioContextRef.current.resume();
        }
        return audioContextRef.current;
    }, [volume, isMuted]);

    const scheduleBuffer = useCallback((ctx: AudioContext, buffer: AudioBuffer): void => {
        const gain = gainNodeRef.current;
        if (!gain) return;

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        // Per-chunk envelope for click-free joins. The envelope graph is
        // source → chunkGain → mainGain → destination. chunkGain does a
        // 2 ms ramp up at start and 2 ms ramp down at end.
        const chunkGain = ctx.createGain();
        source.connect(chunkGain).connect(gain);

        // Compute start time with lookahead — never schedule in the past.
        const earliest = ctx.currentTime + SCHEDULING_LOOKAHEAD_SECONDS;
        const startTime = Math.max(earliest, nextStartTimeRef.current);
        const endTime = startTime + buffer.duration;
        const fade = Math.min(CHUNK_FADE_SECONDS, buffer.duration / 4);

        chunkGain.gain.setValueAtTime(0, startTime);
        chunkGain.gain.linearRampToValueAtTime(1, startTime + fade);
        chunkGain.gain.setValueAtTime(1, endTime - fade);
        chunkGain.gain.linearRampToValueAtTime(0, endTime);

        source.start(startTime);
        source.stop(endTime + 0.001);
        nextStartTimeRef.current = endTime;

        queuedCountRef.current += 1;
        setIsPlaying(true);

        source.onended = () => {
            queuedCountRef.current = Math.max(0, queuedCountRef.current - 1);
            if (queuedCountRef.current === 0) {
                // Reset the play cursor only after the tail has drained, so a
                // new utterance starts with fresh lookahead rather than
                // trying to continue from a stale past timestamp.
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
                scheduleBuffer(ctx, audioBuffer);
            } catch (err) {
                console.error("Failed to enqueue audio:", err);
            }
        },
        [getAudioContext, scheduleBuffer]
    );

    const clearQueue = useCallback((): void => {
        // Bump nextStartTime to "now" so any in-flight sources ending naturally
        // don't reset it to a stale value. Already-scheduled sources will play
        // to completion — stopping them mid-buffer would itself click.
        if (audioContextRef.current) {
            nextStartTimeRef.current = audioContextRef.current.currentTime;
        } else {
            nextStartTimeRef.current = 0;
        }
        queuedCountRef.current = 0;
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
