import * as THREE from "three";
import { HeadAudio } from "@met4citizen/headaudio/modules/headaudio.mjs";
import { Avatar3D } from "./Avatar3D";
import type { AvatarVariant, MouthShape } from "./AvatarVariant";

/**
 * Photo-based talking head — the "Realistic" variant.
 *
 * Photorealistic skin without a third-party renderer. The rigged route needs an
 * asset we do not have: "Advisor" (trinity-advisor.glb) is a stylised CC0 mesh,
 * and no AWS service turns a still photo into a rigged real-time talking head.
 *
 * Two problems had to be solved, and both were solved by adding data rather than
 * by tuning code.
 *
 * 1. A single closed-mouth photo cannot show an open mouth. Warping only moves
 *    pixels that exist, and there are no teeth or oral cavity in the source, so
 *    an "open" mouth rendered as a dark blob. Fixed with three textures — closed,
 *    part-open, wide-open — the latter two inpainted from the first so identity,
 *    skin tone and stubble stay consistent. The shader cross-fades between them,
 *    which is the standard viseme-sprite approach.
 *
 * 2. Amplitude relayed through React was choppy. `onAudioLevel` fires every
 *    frame from a requestAnimationFrame loop into a React state setter, which
 *    re-rendered a very large component ~60 times a second and dropped frames.
 *    Amplitude also carries no phonetic meaning, so the mouth flapped instead of
 *    articulating. Fixed by consuming the agent's MediaStreamTrack directly and
 *    running HeadAudio (MIT, already a dependency) in an AudioWorklet: real
 *    Oculus visemes, computed off the main thread, never touching React.
 *
 * Amplitude remains as a fallback for the WebSocket transport, which supplies a
 * level but no track.
 *
 * Still not done: eye blinks (a photographed eyelid cannot be closed
 * convincingly without another exposure) and head rotation (one photo has one
 * angle). Idle motion is a slow sway and breath, which is all a fixed viewpoint
 * honestly supports.
 *
 * Landmarks are measured from advisor-photo.png. Swapping the photo means
 * re-measuring them and re-running the inpaint.
 */

const TEXTURES = {
    closed: "/avatars/advisor-photo.png",
    mid: "/avatars/advisor-photo-mid.png",
    open: "/avatars/advisor-photo-open.png",
};

const WORKLET_URL = "/headaudio/headworklet.min.mjs";
const VISEME_MODEL_URL = "/headaudio/model-en-mixed.bin";

/** Measured from advisor-photo.png. y is from the TOP of the image. */
const LANDMARKS = {
    mouth: { cx: 0.485, cy: 0.575, halfWidth: 0.065, halfHeight: 0.025 },
    jaw: { cx: 0.49, cy: 0.63, halfWidth: 0.16, halfHeight: 0.12 },
};

/** Source image aspect (576 x 768). */
const PHOTO_ASPECT = 576 / 768;

/**
 * Oculus viseme -> (jaw open, mouth width). `open` selects the blend point
 * across the three textures; `wide` spreads or rounds the mouth horizontally,
 * which the textures alone cannot express because they differ only in openness.
 *
 * The top of the range is deliberately capped below 1.0. The wide-open texture
 * is an extreme, and mapping ordinary vowels onto it made the avatar look like
 * it was shouting. Keeping normal speech in the closed -> part-open segment also
 * keeps it in the cleanest of the three textures.
 */
const VISEME_TARGETS: Record<string, { open: number; wide: number }> = {
    viseme_sil: { open: 0.0, wide: 0.0 },
    viseme_PP: { open: 0.02, wide: 0.0 },
    viseme_FF: { open: 0.1, wide: 0.1 },
    viseme_TH: { open: 0.2, wide: 0.0 },
    viseme_DD: { open: 0.22, wide: 0.05 },
    viseme_kk: { open: 0.28, wide: 0.05 },
    viseme_CH: { open: 0.22, wide: 0.3 },
    viseme_SS: { open: 0.12, wide: 0.35 },
    viseme_nn: { open: 0.16, wide: 0.05 },
    viseme_RR: { open: 0.22, wide: -0.1 },
    viseme_aa: { open: 0.66, wide: 0.15 },
    viseme_E: { open: 0.34, wide: 0.4 },
    viseme_I: { open: 0.3, wide: 0.5 },
    viseme_O: { open: 0.5, wide: -0.35 },
    viseme_U: { open: 0.35, wide: -0.55 },
};

/** Fallback map for the WebSocket transport, which sends coarse shapes. */
const SHAPE_TARGETS: Record<MouthShape, { open: number; wide: number }> = {
    neutral: { open: 0.0, wide: 0.0 },
    mm: { open: 0.02, wide: 0.0 },
    ff: { open: 0.1, wide: 0.1 },
    th: { open: 0.2, wide: 0.0 },
    ee: { open: 0.35, wide: 0.5 },
    wide: { open: 0.4, wide: 0.6 },
    narrow: { open: 0.2, wide: -0.4 },
    oo: { open: 0.35, wide: -0.55 },
    oh: { open: 0.5, wide: -0.35 },
    ah: { open: 0.66, wide: 0.15 },
    open: { open: 0.82, wide: 0.1 },
};

const VERTEX_SHADER = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

/**
 * Blends three mouth states and applies only a horizontal shape warp. The jaw
 * drop and mouth interior now come from the textures themselves, so warping
 * them again would double-count and smear.
 */
const FRAGMENT_SHADER = /* glsl */ `
    precision highp float;

    uniform sampler2D uTexClosed;
    uniform sampler2D uTexMid;
    uniform sampler2D uTexOpen;
    uniform float uOpen;    // 0..1 across closed -> mid -> open
    uniform float uWide;    // -1..1 horizontal stretch
    uniform vec2  uMouth;   // mouth centre, UV space
    uniform vec2  uJawR;    // jaw half extents, UV — falloff for the warp

    varying vec2 vUv;

    float ellipse(vec2 p, vec2 c, vec2 r) {
        return length((p - c) / r);
    }

    void main() {
        vec2 uv = vUv;

        // Horizontal mouth shape: scale about the mouth centre, easing out over
        // the jaw so the cheeks follow the lips instead of shearing.
        float wideMask = 1.0 - smoothstep(0.0, 1.4, ellipse(uv, uMouth, uJawR));
        uv.x = uMouth.x + (uv.x - uMouth.x) * (1.0 - uWide * 0.14 * wideMask);

        vec4 a = texture2D(uTexClosed, uv);
        vec4 b = texture2D(uTexMid, uv);
        vec4 c = texture2D(uTexOpen, uv);

        // Two-segment cross-fade. Most speech sits in the lower half, where the
        // part-open texture is the cleanest of the three.
        vec4 colour = uOpen < 0.5
            ? mix(a, b, smoothstep(0.0, 1.0, uOpen * 2.0))
            : mix(b, c, smoothstep(0.0, 1.0, (uOpen - 0.5) * 2.0));

        gl_FragColor = colour;
    }
`;

/** Convert a measured top-down y to UV space (y up). */
function toUvY(yFromTop: number): number {
    return 1.0 - yFromTop;
}

export class Avatar3DPhoto extends Avatar3D implements AvatarVariant {
    private material: THREE.ShaderMaterial;
    private group: THREE.Group;
    private textures: THREE.Texture[] = [];

    /** Rendered values, chased toward the targets each frame. */
    private open = 0;
    private wide = 0;
    private targetOpen = 0;
    private targetWide = 0;

    private speaking = false;
    private audioLevel = 0;
    /** True once a real viseme has arrived, which outranks amplitude. */
    private hasViseme = false;

    // HeadAudio pipeline (LiveKit transport only).
    private audioCtx: AudioContext | null = null;
    private headAudio: HeadAudio | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private visemeValues: Record<string, number> = {};
    private lastFrameMs = 0;
    private disposed = false;

    constructor(container: HTMLElement) {
        super(container);

        const loader = new THREE.TextureLoader();
        const load = (url: string): THREE.Texture => {
            const t = loader.load(url);
            t.colorSpace = THREE.SRGBColorSpace;
            // The warp samples slightly outside the mouth; clamping stops the
            // opposite edge wrapping into frame.
            t.wrapS = THREE.ClampToEdgeWrapping;
            t.wrapT = THREE.ClampToEdgeWrapping;
            t.minFilter = THREE.LinearFilter;
            this.textures.push(t);
            return t;
        };

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTexClosed: { value: load(TEXTURES.closed) },
                uTexMid: { value: load(TEXTURES.mid) },
                uTexOpen: { value: load(TEXTURES.open) },
                uOpen: { value: 0 },
                uWide: { value: 0 },
                uMouth: {
                    value: new THREE.Vector2(LANDMARKS.mouth.cx, toUvY(LANDMARKS.mouth.cy)),
                },
                uJawR: {
                    value: new THREE.Vector2(LANDMARKS.jaw.halfWidth, LANDMARKS.jaw.halfHeight),
                },
            },
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            transparent: false,
        });

        const planeHeight = 3.0;
        const geometry = new THREE.PlaneGeometry(planeHeight * PHOTO_ASPECT, planeHeight);
        this.group = new THREE.Group();
        this.group.add(new THREE.Mesh(geometry, this.material));
        this.group.position.set(0, 0.55, 0);
        this.scene.add(this.group);

        this.camera.position.set(0, 0.6, 2.6);
        this.camera.lookAt(0, 0.6, 0);
        this.updateControlsTarget(0, 0.6, 0);

        this.setAnimationCallback(this.tick);
    }

    protected onAspectChange(aspect: number): void {
        this.reframe(this.camera, 2.6, 0.75, aspect);
    }

    /**
     * Attach the agent's audio track and derive visemes from it directly.
     *
     * The node is deliberately NOT connected to the destination: HeadAudio has
     * an input and no output, and LiveKit already plays the track through its
     * own <audio> element. Connecting it would double the voice.
     */
    async setAudioTrack(track: MediaStreamTrack | null): Promise<void> {
        this.teardownAudio();
        if (!track || this.disposed) return;

        try {
            const ctx = new AudioContext();
            await ctx.audioWorklet.addModule(WORKLET_URL);
            const node = new HeadAudio(ctx, {
                parameterData: { vadGateActiveDb: -45, vadGateInactiveDb: -65 },
            });
            await node.loadModel(VISEME_MODEL_URL);
            // Autoplay policy: safe here because a track only exists after the
            // user has clicked Connect.
            await ctx.resume();

            node.onvalue = (key: string, value: number): void => {
                this.visemeValues[key] = value;
                if (value > 0.05 && key !== "viseme_sil") this.hasViseme = true;
            };

            const source = ctx.createMediaStreamSource(new MediaStream([track]));
            source.connect(node);

            if (this.disposed) {
                ctx.close();
                return;
            }
            this.audioCtx = ctx;
            this.headAudio = node;
            this.sourceNode = source;
        } catch (err) {
            // Fall back to amplitude rather than losing the avatar entirely.
            // eslint-disable-next-line no-console
            console.warn("[Avatar3DPhoto] HeadAudio unavailable, using amplitude:", err);
            this.teardownAudio();
        }
    }

    private teardownAudio(): void {
        this.sourceNode?.disconnect();
        this.sourceNode = null;
        if (this.headAudio) {
            this.headAudio.onvalue = null;
            this.headAudio.disconnect();
            this.headAudio = null;
        }
        this.audioCtx?.close().catch(() => undefined);
        this.audioCtx = null;
        this.visemeValues = {};
        this.hasViseme = false;
    }

    /** Weighted blend of the active visemes into a single open/wide pair. */
    private resolveVisemes(): void {
        let weight = 0;
        let open = 0;
        let wide = 0;
        for (const [key, value] of Object.entries(this.visemeValues)) {
            const target = VISEME_TARGETS[key];
            if (!target || value <= 0.02) continue;
            weight += value;
            open += target.open * value;
            wide += target.wide * value;
        }
        if (weight > 0) {
            this.targetOpen = open / weight;
            this.targetWide = wide / weight;
        } else {
            this.targetOpen = 0;
            this.targetWide = 0;
        }
    }

    private tick = (time: number): void => {
        const dt = this.lastFrameMs ? time - this.lastFrameMs : 16;
        this.lastFrameMs = time;

        if (this.headAudio) {
            // Advances HeadAudio's own easing, which is what removes the jitter
            // that raw per-frame values would otherwise carry.
            this.headAudio.update(dt);
            this.resolveVisemes();
        }

        // Opening faster than closing matches how speech looks and stops the
        // mouth flickering between adjacent visemes.
        const target = this.speaking ? this.targetOpen : 0;
        const rate = target > this.open ? 0.4 : 0.2;
        this.open += (target - this.open) * rate;
        this.wide += ((this.speaking ? this.targetWide : 0) - this.wide) * 0.18;

        this.material.uniforms.uOpen.value = this.open;
        this.material.uniforms.uWide.value = this.wide;

        // Small on purpose: a photograph cannot rotate, so large motion reveals
        // that it is a flat plane.
        const t = time * 0.001;
        this.group.position.x = Math.sin(t * 0.31) * 0.012;
        this.group.position.y = 0.55 + Math.sin(t * 0.47) * 0.008;
        this.group.rotation.z = Math.sin(t * 0.23) * 0.005;
    };

    updateLipSync(audioLevel: number): void {
        this.audioLevel = audioLevel;
        // Amplitude only drives the mouth when no viseme stream exists.
        if (!this.hasViseme) {
            this.targetOpen = Math.min(Math.max(audioLevel, 0), 1) * 0.7;
            this.targetWide = 0;
        }
    }

    setMouthShape(shape: MouthShape): void {
        // HeadAudio outranks the coarse shape stream. Beyond that, only a
        // non-neutral shape proves a viseme stream exists — the LiveKit path
        // pushes "neutral" on mount, which previously latched the flag and
        // disabled the amplitude fallback, freezing the mouth shut.
        if (this.headAudio) return;
        if (shape !== "neutral") {
            this.hasViseme = true;
        } else if (!this.hasViseme) {
            return;
        }

        const target = SHAPE_TARGETS[shape] ?? SHAPE_TARGETS.neutral;
        const gain = this.audioLevel > 0 ? Math.min(0.55 + this.audioLevel * 0.75, 1.25) : 1.0;
        this.targetOpen = Math.min(target.open * gain, 1);
        this.targetWide = target.wide;
    }

    setSpeaking(isSpeaking: boolean): void {
        this.speaking = isSpeaking;
        if (!isSpeaking) {
            this.targetOpen = 0;
            this.targetWide = 0;
        }
    }

    setEyeColor(): void {
        // No-op: the eyes are photographic pixels, not emissive material. Part of
        // the AvatarVariant contract the generated variants use.
    }

    dispose(): void {
        this.disposed = true;
        this.teardownAudio();
        this.textures.forEach((t) => t.dispose());
        this.textures = [];
        super.dispose();
    }
}
