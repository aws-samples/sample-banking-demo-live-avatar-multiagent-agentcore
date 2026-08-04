import * as THREE from "three";
import { Avatar3D } from "./Avatar3D";
import type { AvatarVariant, MouthShape } from "./AvatarVariant";

/**
 * Photo-based talking head — the "Realistic" variant.
 *
 * A photograph rendered on a plane, with the lower face warped per viseme in a
 * fragment shader. This exists because the photorealistic route has no rigged
 * asset: `trinity-advisor.glb` (the "Advisor" variant) is a stylised CC0 mesh,
 * and no AWS service turns a still photo into a rigged, real-time talking head.
 * Warping a real photograph is the self-contained way to get photorealistic skin
 * without a third-party rendering service.
 *
 * Why warp UVs in the fragment shader rather than displace geometry: a UV warp
 * keeps the silhouette rectangular and stretches pixels smoothly, so there are
 * no faceting artifacts from a coarse vertex grid and no per-frame CPU work over
 * thousands of vertices. The plane stays two triangles.
 *
 * What it does NOT do: eye blinks (closing a photographed eyelid convincingly
 * needs a second exposure or an inpainted lid, and a scaled-down eye region
 * reads as a glitch), and head rotation (a single photo has no other angles).
 * Idle motion is limited to a slow sway and breath, which is what a fixed
 * viewpoint can support honestly.
 *
 * KNOWN LIMITATION — not yet demo-grade. Verified in a headless browser with a
 * vision model scoring the render: the shader compiles, the warp is correct, and
 * nothing outside the mouth and jaw distorts, but the open mouth reads as a dark
 * blob rather than a mouth. The cause is structural, not a tuning problem: the
 * source photograph has the lips closed, so there are no teeth or oral-cavity
 * pixels anywhere in the texture. Separating the lips and shading between them
 * can only reveal what the image contains, which is nothing.
 *
 * The fix is a second texture rather than more shader tuning. Inpaint an
 * open-mouth version of this same photo (us.stability.stable-image-inpaint-v1:0
 * is available in this account and preserves surrounding identity), then blend
 * closed -> open by uOpen so real teeth and cavity appear. That is the standard
 * viseme-sprite approach and it is what this needs before it goes on camera.
 *
 * Landmarks below were measured once from advisor-photo.png and are specific to
 * it. Swapping the photo requires re-measuring. Coordinates are in TEXTURE space
 * with y increasing DOWNWARD, matching how the image was measured; the shader
 * converts to UV space (y up) on entry.
 */

const PHOTO_URL = "/avatars/advisor-photo.png";

/** Measured from advisor-photo.png. y is from the TOP of the image. */
const LANDMARKS = {
    mouth: { cx: 0.485, cy: 0.575, halfWidth: 0.065, halfHeight: 0.025 },
    jaw: { cx: 0.49, cy: 0.63, halfWidth: 0.16, halfHeight: 0.12 },
    chinY: 0.75,
};

/** Source image aspect (576 x 768). */
const PHOTO_ASPECT = 576 / 768;

/**
 * Viseme to (jaw open, mouth width) mapping. `open` drives how far the jaw
 * drops and how wide the dark mouth interior grows; `wide` stretches the mouth
 * horizontally for spread vowels and narrows it for rounded ones.
 */
const VISEME_TARGETS: Record<MouthShape, { open: number; wide: number }> = {
    neutral: { open: 0.0, wide: 0.0 },
    mm: { open: 0.02, wide: 0.0 },
    ff: { open: 0.08, wide: 0.1 },
    th: { open: 0.18, wide: 0.0 },
    ee: { open: 0.15, wide: 0.55 },
    wide: { open: 0.22, wide: 0.6 },
    narrow: { open: 0.12, wide: -0.4 },
    oo: { open: 0.3, wide: -0.55 },
    oh: { open: 0.42, wide: -0.35 },
    ah: { open: 0.5, wide: 0.15 },
    open: { open: 0.6, wide: 0.1 },
};

const VERTEX_SHADER = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    precision highp float;

    uniform sampler2D uTexture;
    uniform float uOpen;        // 0..1 jaw open amount
    uniform float uWide;        // -1..1 horizontal mouth stretch
    uniform vec2  uMouth;       // mouth centre, UV space
    uniform vec2  uMouthR;      // mouth half extents, UV
    uniform vec2  uJaw;         // jaw centre, UV space
    uniform vec2  uJawR;        // jaw half extents, UV
    uniform float uChinY;       // chin line, UV space (lower bound of warp)

    varying vec2 vUv;

    // Normalised elliptical distance: 0 at centre, 1 at the boundary.
    float ellipse(vec2 p, vec2 c, vec2 r) {
        vec2 d = (p - c) / r;
        return length(d);
    }

    void main() {
        vec2 uv = vUv;

        // ---- Jaw drop -------------------------------------------------------
        // Sampling from ABOVE the current pixel makes content appear to move
        // DOWN, which is what a dropping jaw looks like. Gated to the region
        // below the mouth line so the nose and eyes never move, and faded out at
        // the chin so the warp does not drag the background.
        float jawFall = 1.0 - smoothstep(0.0, 1.0, ellipse(uv, uJaw, uJawR));
        float belowMouth = smoothstep(0.03, -0.02, uv.y - uMouth.y);
        float aboveChin = smoothstep(uChinY - 0.04, uChinY + 0.06, uv.y);
        float jawMask = jawFall * belowMouth * aboveChin;

        // A photograph has no occluded geometry behind the jaw, so travel is
        // bounded to avoid smearing the stubble and collar. It still has to be
        // large enough to read as speech at normal viewing size.
        uv.y += uOpen * 0.055 * jawMask;

        // ---- Lip separation ------------------------------------------------
        // Shading between the lips is not enough on its own: the source photo
        // has a closed-lip smile, and darkening alone reads as a smudge rather
        // than an opening. Pushing the sample point AWAY from the mouth centre
        // line moves the upper lip up and the lower lip down, opening a real
        // gap that the shading below then fills.
        float lipFall = 1.0 - smoothstep(0.0, 1.0, ellipse(uv, uMouth, uMouthR * vec2(1.6, 3.2)));
        float side = sign(uv.y - uMouth.y);
        uv.y -= side * uOpen * 0.026 * lipFall;

        // ---- Horizontal mouth shape ----------------------------------------
        // Scale about the mouth centre, strongest at the mouth and easing out
        // across the jaw, so the cheeks follow the lips instead of shearing.
        float wideMask = 1.0 - smoothstep(0.0, 1.4, ellipse(uv, uMouth, uJawR));
        uv.x = uMouth.x + (uv.x - uMouth.x) * (1.0 - uWide * 0.16 * wideMask);

        vec4 colour = texture2D(uTexture, uv);

        // ---- Mouth interior -------------------------------------------------
        // Darkening a lens-shaped region between the lips is what sells an open
        // mouth on a still photo. Without it the lips just stretch and the face
        // reads as rubbery rather than speaking.
        vec2 innerR = vec2(uMouthR.x * (0.92 + uWide * 0.35), uMouthR.y * (0.30 + uOpen * 4.6));
        float inner = 1.0 - smoothstep(0.35, 1.0, ellipse(vUv, uMouth + vec2(0.0, -uOpen * 0.012), innerR));
        float shade = inner * uOpen * 0.92;
        colour.rgb *= (1.0 - shade);

        gl_FragColor = colour;
    }
`;

/** Convert a measured top-down y to UV space (y up). */
function toUvY(yFromTop: number): number {
    return 1.0 - yFromTop;
}

export class Avatar3DPhoto extends Avatar3D implements AvatarVariant {
    private material: THREE.ShaderMaterial;
    private mesh: THREE.Mesh;
    private group: THREE.Group;

    /** Smoothed values actually rendered, chased toward the targets each frame. */
    private open = 0;
    private wide = 0;
    private targetOpen = 0;
    private targetWide = 0;

    private speaking = false;
    /** Amplitude fallback for the WebSocket path, which has no viseme stream. */
    private audioLevel = 0;
    private hasViseme = false;

    constructor(container: HTMLElement) {
        super(container);

        const texture = new THREE.TextureLoader().load(PHOTO_URL, () => {
            // Re-render once decoding finishes; the shared loop handles the rest.
            texture.needsUpdate = true;
        });
        texture.colorSpace = THREE.SRGBColorSpace;
        // The warp samples slightly outside the mouth region near the edges;
        // clamping avoids wrapping a stripe of the opposite edge into frame.
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTexture: { value: texture },
                uOpen: { value: 0 },
                uWide: { value: 0 },
                uMouth: {
                    value: new THREE.Vector2(LANDMARKS.mouth.cx, toUvY(LANDMARKS.mouth.cy)),
                },
                uMouthR: {
                    value: new THREE.Vector2(LANDMARKS.mouth.halfWidth, LANDMARKS.mouth.halfHeight),
                },
                uJaw: { value: new THREE.Vector2(LANDMARKS.jaw.cx, toUvY(LANDMARKS.jaw.cy)) },
                uJawR: {
                    value: new THREE.Vector2(LANDMARKS.jaw.halfWidth, LANDMARKS.jaw.halfHeight),
                },
                uChinY: { value: toUvY(LANDMARKS.chinY) },
            },
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            transparent: false,
        });

        // Plane sized so the head reads at a comfortable scale in the panel.
        const planeHeight = 3.0;
        const geometry = new THREE.PlaneGeometry(planeHeight * PHOTO_ASPECT, planeHeight);
        this.mesh = new THREE.Mesh(geometry, this.material);

        // Grouped so idle sway can move the photo without touching the camera,
        // which the user can also orbit.
        this.group = new THREE.Group();
        this.group.add(this.mesh);
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

    private tick = (time: number): void => {
        // Chase the targets rather than snapping. Opening faster than closing
        // matches how speech actually looks and stops the mouth flickering
        // between adjacent visemes.
        const target = this.speaking ? this.targetOpen : 0;
        const rate = target > this.open ? 0.45 : 0.22;
        this.open += (target - this.open) * rate;
        this.wide += ((this.speaking ? this.targetWide : 0) - this.wide) * 0.2;

        this.material.uniforms.uOpen.value = this.open;
        this.material.uniforms.uWide.value = this.wide;

        // Idle sway and breath. Small on purpose: a photograph cannot rotate, so
        // large motion reveals that it is a flat plane.
        const t = time * 0.001;
        this.group.position.x = Math.sin(t * 0.31) * 0.012;
        this.group.position.y = 0.55 + Math.sin(t * 0.47) * 0.008;
        this.group.rotation.z = Math.sin(t * 0.23) * 0.005;
    };

    updateLipSync(audioLevel: number): void {
        this.audioLevel = audioLevel;
        // Only drive the mouth from amplitude when no viseme has arrived. The
        // LiveKit path supplies real visemes and should win; the WebSocket path
        // supplies only a level.
        if (!this.hasViseme) {
            this.targetOpen = Math.min(Math.max(audioLevel, 0), 1) * 0.55;
            this.targetWide = 0;
        }
    }

    setMouthShape(shape: MouthShape): void {
        const target = VISEME_TARGETS[shape] ?? VISEME_TARGETS.neutral;
        this.hasViseme = true;
        // Scale the opening by measured loudness so quiet speech does not gape.
        const gain = this.audioLevel > 0 ? Math.min(0.55 + this.audioLevel * 0.75, 1.25) : 1.0;
        this.targetOpen = target.open * gain;
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
        // the AvatarVariant contract, which the generated variants use.
    }

    dispose(): void {
        this.material.uniforms.uTexture.value?.dispose();
        super.dispose();
    }
}
