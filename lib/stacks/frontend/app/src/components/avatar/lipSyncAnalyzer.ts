/**
 * Lightweight PCM chunk analyser for avatar lip-sync.
 *
 * Nova Sonic streams 24 kHz mono 16-bit PCM as base64 chunks. The previous
 * `audioLevel = bytes / 5000` approach gave every chunk of the same size the
 * same mouth-open value, so the mouth never matched what the avatar was
 * actually saying.
 *
 * `analyzeChunk(base64Pcm)` returns:
 *   - rms:   amplitude envelope in [0, 1], with a small noise floor so the
 *            mouth actually snaps shut during pauses between words.
 *   - shape: coarse viseme bucket derived from zero-crossing rate + low-band
 *            energy. Not true formant extraction — it's a cheap proxy that
 *            maps voiced lows → {ah, oh, oo, mm}, voiced highs → {ee, wide},
 *            fricatives → {ff, th}, and a final `neutral` for silence.
 *            60 ms hold-over smoothing prevents jitter between chunks.
 */

import type { MouthShape } from "./AvatarVariant";

const NOVA_SONIC_SAMPLE_RATE = 24_000;
const NOISE_FLOOR = 0.02; // below this, mouth is fully closed
const RMS_CEILING = 0.35; // Nova Sonic rarely exceeds this in practice
const SHAPE_HOLD_MS = 60; // minimum time a shape sticks before it can change

interface AnalyzerState {
    lastShape: MouthShape;
    lastShapeChangeAt: number;
}

const state: AnalyzerState = {
    lastShape: "neutral",
    lastShapeChangeAt: 0,
};

/** Decode a base64 PCM (16-bit little-endian mono) chunk into an Int16Array. */
export function base64PcmToInt16Array(b64: string): Int16Array {
    const bin = atob(b64);
    const len = bin.length;
    const out = new ArrayBuffer(len);
    const view = new Uint8Array(out);
    for (let i = 0; i < len; i++) {
        view[i] = bin.charCodeAt(i);
    }
    return new Int16Array(out);
}

function computeRms(samples: Int16Array): number {
    if (samples.length === 0) return 0;
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i] / 32768; // normalise to [-1, 1]
        sumSq += s * s;
    }
    const raw = Math.sqrt(sumSq / samples.length);
    if (raw < NOISE_FLOOR) return 0;
    // Map [NOISE_FLOOR, RMS_CEILING] -> [0, 1], clamp above.
    return Math.min(1, (raw - NOISE_FLOOR) / (RMS_CEILING - NOISE_FLOOR));
}

/** Samples per second crossing the zero line — cheap pitch / formant proxy. */
function computeZeroCrossingRate(samples: Int16Array): number {
    if (samples.length < 2) return 0;
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
        const prev = samples[i - 1];
        const cur = samples[i];
        if ((prev >= 0 && cur < 0) || (prev < 0 && cur >= 0)) crossings++;
    }
    // crossings per sample * sample rate = crossings per second.
    return (crossings / samples.length) * NOVA_SONIC_SAMPLE_RATE;
}

/** Fraction of total energy in the low-band (|sample| > median). Cheap voiced-ness proxy. */
function computeLowBandEnergyRatio(samples: Int16Array): number {
    if (samples.length === 0) return 0;
    // Lightweight IIR low-pass (one-pole) so we don't need an FFT.
    // Cutoff ~800 Hz at 24 kHz -> alpha ≈ 0.18.
    const alpha = 0.18;
    let lp = 0;
    let lowEnergy = 0;
    let totalEnergy = 0;
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i] / 32768;
        lp = lp + alpha * (s - lp);
        lowEnergy += lp * lp;
        totalEnergy += s * s;
    }
    if (totalEnergy === 0) return 0;
    return Math.min(1, lowEnergy / totalEnergy);
}

function classifyShape(rms: number, zcr: number, lowRatio: number): MouthShape {
    if (rms === 0) return "neutral";

    // Unvoiced / high-frequency noise: fricatives like "s", "sh", "f".
    // ZCR for fricatives is typically > 4 kHz/s on 24 kHz mono.
    if (zcr > 4500 && lowRatio < 0.35) {
        return "ff";
    }
    if (zcr > 3200 && lowRatio < 0.5) {
        return "th";
    }

    // Voiced, low-energy: closed or nearly-closed lips (bilabial, nasal).
    if (rms < 0.2) {
        return lowRatio > 0.7 ? "mm" : "narrow";
    }

    // Strongly voiced, back-vowel dominant (low-band heavy, low ZCR).
    if (lowRatio > 0.75) {
        return rms > 0.6 ? "oh" : "oo";
    }

    // Voiced, more mid-band energy: front vowel "ee".
    if (lowRatio < 0.55 && zcr > 1800) {
        return rms > 0.5 ? "ee" : "wide";
    }

    // Default voiced open vowel — "ah" at peaks, "open" for the loudest hits.
    return rms > 0.7 ? "open" : "ah";
}

export interface ChunkAnalysis {
    rms: number;
    shape: MouthShape;
}

export function analyzeChunk(base64Pcm: string): ChunkAnalysis {
    const samples = base64PcmToInt16Array(base64Pcm);
    const rms = computeRms(samples);
    const zcr = computeZeroCrossingRate(samples);
    const lowRatio = computeLowBandEnergyRatio(samples);
    const rawShape = classifyShape(rms, zcr, lowRatio);

    const now = performance.now();
    if (rawShape === state.lastShape) {
        return { rms, shape: rawShape };
    }
    // Hold previous shape briefly so we don't flicker between visemes on
    // every 20-40 ms chunk.
    if (now - state.lastShapeChangeAt < SHAPE_HOLD_MS && state.lastShape !== "neutral") {
        return { rms, shape: state.lastShape };
    }
    state.lastShape = rawShape;
    state.lastShapeChangeAt = now;
    return { rms, shape: rawShape };
}

export function resetAnalyzer(): void {
    state.lastShape = "neutral";
    state.lastShapeChangeAt = 0;
}
