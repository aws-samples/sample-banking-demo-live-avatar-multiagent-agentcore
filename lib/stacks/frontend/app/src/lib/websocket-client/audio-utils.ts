/**
 * Audio utilities for PCM encode/decode and base64 helpers.
 *
 * Input (microphone → agent): 16kHz mono PCM
 * Output (agent → speakers): 24kHz mono PCM (Nova Sonic native output rate)
 */

const SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/**
 * Creates an AudioWorklet processor script as a Blob URL for real-time
 * downsampling from the microphone's native sample rate to 16kHz mono PCM.
 */
export function createPCMProcessorUrl(): string {
    const processorCode = `
    class PCMProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this._buffer = [];
      }

      process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;

        const channelData = input[0];
        if (!channelData) return true;

        // Downsample from native rate to 16kHz
        const ratio = sampleRate / ${SAMPLE_RATE};
        for (let i = 0; i < channelData.length; i += ratio) {
          const idx = Math.floor(i);
          if (idx < channelData.length) {
            this._buffer.push(channelData[idx]);
          }
        }

        // Send chunks of ~4096 samples (256ms at 16kHz)
        while (this._buffer.length >= 4096) {
          const chunk = this._buffer.splice(0, 4096);
          const pcm = float32ToPCM16(new Float32Array(chunk));
          this.port.postMessage(pcm.buffer, [pcm.buffer]);
        }

        return true;
      }
    }

    function float32ToPCM16(float32Array) {
      const pcm16 = new Int16Array(float32Array.length);
      for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      return pcm16;
    }

    registerProcessor('pcm-processor', PCMProcessor);
  `;

    const blob = new Blob([processorCode], { type: "application/javascript" });
    return URL.createObjectURL(blob);
}

/**
 * Converts a Float32Array of audio samples to 16-bit PCM Int16Array.
 */
export function float32ToPCM16(float32Array: Float32Array): Int16Array {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm16;
}

/**
 * Converts a 16-bit PCM Int16Array to Float32Array.
 */
export function pcm16ToFloat32(pcm16: Int16Array): Float32Array {
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
    }
    return float32;
}

/**
 * Encodes an ArrayBuffer to a base64 string.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Decodes a base64 string to an ArrayBuffer.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Decodes base64-encoded PCM audio to an AudioBuffer for playback.
 * Uses OUTPUT_SAMPLE_RATE (24kHz) since Nova Sonic outputs at 24kHz.
 */
export function pcmBase64ToAudioBuffer(base64: string, audioContext: AudioContext): AudioBuffer {
    const pcmBuffer = base64ToArrayBuffer(base64);
    const pcm16 = new Int16Array(pcmBuffer);
    const float32 = pcm16ToFloat32(pcm16);

    const audioBuffer = audioContext.createBuffer(CHANNELS, float32.length, OUTPUT_SAMPLE_RATE);
    audioBuffer.copyToChannel(float32 as Float32Array<ArrayBuffer>, 0);
    return audioBuffer;
}

export { SAMPLE_RATE, OUTPUT_SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE };
