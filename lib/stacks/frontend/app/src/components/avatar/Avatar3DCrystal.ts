import * as THREE from "three";
import { RoomEnvironment } from "three-stdlib";
import { Avatar3D } from "./Avatar3D";
import type { AvatarVariant, MouthShape } from "./AvatarVariant";

/**
 * Per-viseme behaviour profile for the crystal.
 *
 * - `shardDir` is +1 for outward bursts (vowels), -1 for inward retraction
 *   (closed consonants like "mm"), 0 for neutral wobble.
 * - `sparkleSpeed` scales the equator sparkle spin — faster on fricatives.
 * - `coreRoughness` shifts facet reflections: smoother for round vowels,
 *   crisper for wide vowels.
 */
const CRYSTAL_SHAPE_PROFILE: Record<
    MouthShape,
    { shardDir: number; sparkleSpeed: number; coreRoughness: number; coreStretchY: number }
> = {
    open: { shardDir: 1.2, sparkleSpeed: 1.1, coreRoughness: 0.08, coreStretchY: 1.0 },
    ah: { shardDir: 1.0, sparkleSpeed: 1.0, coreRoughness: 0.08, coreStretchY: 1.0 },
    oh: { shardDir: 0.9, sparkleSpeed: 0.9, coreRoughness: 0.06, coreStretchY: 1.0 },
    // "ee" stretches the core slightly vertically so the viseme reads on
    // the silhouette, not just in shard behaviour.
    ee: { shardDir: 1.0, sparkleSpeed: 1.3, coreRoughness: 0.1, coreStretchY: 1.3 },
    oo: { shardDir: 0.7, sparkleSpeed: 0.8, coreRoughness: 0.05, coreStretchY: 1.0 },
    wide: { shardDir: 1.0, sparkleSpeed: 1.2, coreRoughness: 0.1, coreStretchY: 1.0 },
    narrow: { shardDir: 0.4, sparkleSpeed: 0.7, coreRoughness: 0.08, coreStretchY: 1.0 },
    mm: { shardDir: -0.8, sparkleSpeed: 0.4, coreRoughness: 0.12, coreStretchY: 1.0 },
    ff: { shardDir: 0.3, sparkleSpeed: 1.6, coreRoughness: 0.14, coreStretchY: 1.0 },
    th: { shardDir: 0.3, sparkleSpeed: 1.5, coreRoughness: 0.14, coreStretchY: 1.0 },
    neutral: { shardDir: 0, sparkleSpeed: 0.4, coreRoughness: 0.08, coreStretchY: 1.0 },
};

/**
 * Crystalline orb avatar with floating shards and sparkle ring.
 */
export class Avatar3DCrystal extends Avatar3D implements AvatarVariant {
    private coreMesh: THREE.Mesh;
    private coreMat: THREE.MeshPhysicalMaterial;
    private shards: THREE.Mesh[] = [];
    private shardBasePositions: THREE.Vector3[] = [];
    // Shard base orientations — stored so the per-axis wobble can be added
    // on top of a fixed pose instead of drifting cumulatively.
    private shardBaseRotX: number[] = [];
    private shardBaseRotY: number[] = [];
    private sparkleRing: THREE.Points;
    private rimLight!: THREE.DirectionalLight;
    private accentColor = new THREE.Color(0x9ad9ff);

    private audioLevel = 0;
    private isSpeaking = false;
    private mouthShape: MouthShape = "neutral";

    constructor(container: HTMLElement) {
        super(container);

        // Camera for crystal
        this.camera.position.set(0, 0, 3.2);
        this.camera.lookAt(0, 0, 0);
        this.updateControlsTarget(0, 0, 0);

        // ACES tone-mapping for proper highlight rolloff on glass facets.
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        // Radial gradient background — cool twilight so the crystal's
        // icy highlights pop without the orb floating in a black void.
        const bg = document.createElement("canvas");
        bg.width = 512;
        bg.height = 512;
        const ctx = bg.getContext("2d")!;
        const grad = ctx.createRadialGradient(256, 256, 60, 256, 256, 360);
        grad.addColorStop(0, "#162a3f");
        grad.addColorStop(1, "#04060c");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 512);
        this.scene.background = new THREE.CanvasTexture(bg);

        // PBR env map drives the facet reflections — without this the
        // Physical material falls back to flat-shaded grey.
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(RoomEnvironment(), 0.04).texture;
        pmrem.dispose();

        // Core octahedron — MeshPhysicalMaterial with transmission gives real
        // glass refraction rather than the old Phong fake-shininess.
        const coreGeo = new THREE.OctahedronGeometry(1, 0);
        this.coreMat = new THREE.MeshPhysicalMaterial({
            color: 0x9ad9ff,
            emissive: 0x2a5a82,
            emissiveIntensity: 0.4,
            metalness: 0.0,
            roughness: 0.08,
            transmission: 0.6, // glass-like see-through
            thickness: 0.8,
            ior: 1.5,
            attenuationColor: 0x88ccff,
            attenuationDistance: 2.5,
            clearcoat: 1.0,
            clearcoatRoughness: 0.05,
            transparent: true,
            opacity: 0.92,
            flatShading: true,
        });
        this.coreMesh = new THREE.Mesh(coreGeo, this.coreMat);
        this.scene.add(this.coreMesh);

        // Floating shards — share the same glass look but simpler (no
        // transmission, which would be too expensive on 10 cones).
        const shardCount = 10;
        for (let i = 0; i < shardCount; i++) {
            const shardGeo = new THREE.ConeGeometry(0.1, 0.6 + Math.random() * 0.4, 4);
            const shardMat = new THREE.MeshStandardMaterial({
                color: 0xbae4ff,
                emissive: 0x224a6c,
                emissiveIntensity: 0.4,
                metalness: 0.4,
                roughness: 0.15,
                transparent: true,
                opacity: 0.75,
                flatShading: true,
            });
            const shard = new THREE.Mesh(shardGeo, shardMat);

            // Distribute radially
            const angle = (i / shardCount) * Math.PI * 2;
            const tilt = (Math.random() - 0.5) * Math.PI * 0.6;
            const r = 1.3 + Math.random() * 0.3;
            const pos = new THREE.Vector3(
                r * Math.cos(angle) * Math.cos(tilt),
                r * Math.sin(tilt),
                r * Math.sin(angle) * Math.cos(tilt)
            );
            shard.position.copy(pos);
            shard.lookAt(0, 0, 0);
            shard.rotateX(Math.PI); // point outward

            this.shards.push(shard);
            this.shardBasePositions.push(pos.clone());
            this.shardBaseRotX.push(shard.rotation.x);
            this.shardBaseRotY.push(shard.rotation.y);
            this.scene.add(shard);
        }

        // Sparkle equator ring
        const sparkleCount = 200;
        const sparkleGeo = new THREE.BufferGeometry();
        const sparklePos = new Float32Array(sparkleCount * 3);
        for (let i = 0; i < sparkleCount; i++) {
            const angle = (i / sparkleCount) * Math.PI * 2;
            const r = 1.8 + (Math.random() - 0.5) * 0.2;
            sparklePos[i * 3] = r * Math.cos(angle);
            sparklePos[i * 3 + 1] = (Math.random() - 0.5) * 0.15;
            sparklePos[i * 3 + 2] = r * Math.sin(angle);
        }
        sparkleGeo.setAttribute("position", new THREE.BufferAttribute(sparklePos, 3));
        const sparkleMat = new THREE.PointsMaterial({
            size: 0.04,
            transparent: true,
            opacity: 0.5,
            color: 0xffffff,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        this.sparkleRing = new THREE.Points(sparkleGeo, sparkleMat);
        this.scene.add(this.sparkleRing);

        // Extra directional light for crystal shimmer — promoted to a field
        // so its intensity can ride speech amplitude.
        this.rimLight = new THREE.DirectionalLight(0x88bbff, 0.5);
        this.rimLight.position.set(-2, 1, -3);
        this.scene.add(this.rimLight);

        this.setAnimationCallback(this.onAnimate.bind(this));
    }

    private onAnimate(time: number): void {
        const t = time * 0.001;
        const intensity = this.isSpeaking ? this.audioLevel : 0.02;
        const profile = CRYSTAL_SHAPE_PROFILE[this.mouthShape];

        // Facet roughness tracks the viseme so "mm" reads cloudier and
        // "ee" reads crisper than plain "ah".
        this.coreMat.roughness = profile.coreRoughness;

        // Core rotation — faster oscillation when speaking
        const rotSpeed = this.isSpeaking ? 0.6 + intensity * 0.8 : 0.3;
        this.coreMesh.rotation.y = t * rotSpeed;
        this.coreMesh.rotation.x =
            Math.sin(t * 0.2) * 0.1 + (this.isSpeaking ? Math.sin(t * 5) * intensity * 0.1 : 0);
        // Rhythmic scale pulsing tied to audio. Per-axis so "ee" stretches
        // the core vertically — the viseme shows up in silhouette, not just
        // in shard behaviour.
        const corePulse = this.isSpeaking
            ? 1 + intensity * 0.2 + Math.sin(t * 8) * intensity * 0.06
            : 1 + Math.sin(t * 0.6) * 0.01;
        const stretchY = profile.coreStretchY ?? 1;
        this.coreMesh.scale.set(corePulse, corePulse * stretchY, corePulse);

        // Emissive pulse — brighter flash on audio peaks
        const emissiveIntensity = 0.15 + intensity * 0.8;
        this.coreMat.emissive.copy(this.accentColor).multiplyScalar(emissiveIntensity);
        this.coreMat.opacity = 0.75 + intensity * 0.25;

        // Shards: burst outward on vowels, retract inward on closed consonants
        // ("mm"), gentle float when idle. Direction comes from the viseme
        // profile so the user can see consonants pull the shards in.
        this.shards.forEach((shard, i) => {
            const base = this.shardBasePositions[i];
            const dir = base.clone().normalize();
            const pulse = intensity * 0.8 * profile.shardDir * Math.sin(t * 5 + i * 0.8);
            const float = Math.sin(t * 0.5 + i * 0.7) * 0.05;
            shard.position.copy(base).addScaledVector(dir, pulse + float);

            // Rotate shards faster when speaking. Idle-axis wobble on X/Y
            // (previously frozen) + scale pulse so each shard reacts along
            // all three axes instead of just spinning on Z.
            shard.rotation.z = t * (0.5 + intensity * 4);
            shard.rotation.x = this.shardBaseRotX[i] + Math.sin(t * 2 + i) * intensity * 0.4;
            shard.rotation.y = this.shardBaseRotY[i] + Math.cos(t * 2 + i * 1.3) * intensity * 0.4;
            shard.scale.setScalar(1 + intensity * 0.25 * profile.shardDir);

            // Emissive on shards — bright flicker
            const shardMat = shard.material as THREE.MeshStandardMaterial;
            shardMat.emissive.copy(this.accentColor).multiplyScalar(emissiveIntensity * 0.8);
            shardMat.opacity = 0.5 + intensity * 0.5;
        });

        // Rim light rides amplitude — brightens the whole scene on peaks
        // so the crystal doesn't feel lit by a static bulb.
        this.rimLight.intensity = 0.5 + intensity * 0.8;

        // Sparkle ring — faster spin and expansion when speaking. Viseme
        // profile scales the speed so fricatives (ff/th) read as a faster,
        // dusty shimmer while nasals (mm) almost stop.
        const baseSparkleSpeed = this.isSpeaking ? 0.8 + intensity * 0.6 : 0.4;
        const sparkleSpeed = baseSparkleSpeed * profile.sparkleSpeed;
        this.sparkleRing.rotation.y = -t * sparkleSpeed;
        (this.sparkleRing.material as THREE.PointsMaterial).opacity = 0.3 + intensity * 0.7;
        (this.sparkleRing.material as THREE.PointsMaterial).size = 0.04 + intensity * 0.04;
        const sparkleScale = 1 + intensity * 0.4;
        this.sparkleRing.scale.setScalar(sparkleScale);
    }

    updateLipSync(audioLevel: number): void {
        this.audioLevel = audioLevel;
    }

    setSpeaking(isSpeaking: boolean): void {
        this.isSpeaking = isSpeaking;
        if (!isSpeaking) {
            this.audioLevel = 0;
            this.mouthShape = "neutral";
        }
    }

    setEyeColor(hexColor: number): void {
        this.accentColor.set(hexColor);
        this.coreMat.color.set(hexColor);
    }

    setMouthShape(shape: MouthShape): void {
        this.mouthShape = shape;
    }

    protected override onAspectChange(aspect: number): void {
        this.reframe(this.camera, 3.2, 1.0, aspect);
    }
}
