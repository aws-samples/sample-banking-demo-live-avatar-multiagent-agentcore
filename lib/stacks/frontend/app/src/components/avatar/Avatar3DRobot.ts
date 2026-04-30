import * as THREE from "three";
import { RoomEnvironment } from "three-stdlib";
import { RoundedBoxGeometry } from "three-stdlib";
import { Avatar3D } from "./Avatar3D";
import type { AvatarVariant, QualityTier } from "./AvatarVariant";

// ---------------------------------------------------------------------------
// Mouth-shape (viseme) helpers
// ---------------------------------------------------------------------------

type MouthShape =
    | "open"
    | "ah"
    | "oh"
    | "ee"
    | "oo"
    | "wide"
    | "narrow"
    | "mm"
    | "ff"
    | "th"
    | "neutral";

interface MouthShapePhysics {
    heightMultiplier: number;
    widthMultiplier: number;
    dropMultiplier: number;
    protrusionMultiplier: number;
    yOffset: number;
    zOffset: number;
    rotation: number;
}

const HIGH_SHAPES: MouthShape[] = ["open", "ah", "wide", "oh"];
const MEDIUM_SHAPES: MouthShape[] = ["ee", "oo", "oh", "ah", "narrow"];
const LOW_SHAPES: MouthShape[] = ["mm", "ff", "th", "narrow", "neutral"];

function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Chef Robot Avatar
// ---------------------------------------------------------------------------

export class Avatar3DRobot extends Avatar3D implements AvatarVariant {
    // Colour palette
    private readonly robotColor = 0xe8e8e8;
    private readonly accentColor = 0x4a90e2;
    private readonly secondaryAccent = 0x7ed321;
    private readonly apronColor = 0xffffff;
    private readonly hatColor = 0xffffff;
    private readonly defaultEyeColor = 0x5dade2;

    // Main groups / meshes
    private robotGroup!: THREE.Group;
    private head!: THREE.Mesh;
    private body!: THREE.Mesh;
    private screen!: THREE.Mesh;
    private base!: THREE.Mesh;
    private hoverRing!: THREE.Mesh;
    private chefHat!: THREE.Group;

    // Arms (articulated)
    private leftUpperArm!: THREE.Mesh;
    private leftLowerArm!: THREE.Mesh;
    private rightUpperArm!: THREE.Mesh;
    private rightLowerArm!: THREE.Mesh;
    private whisk!: THREE.Group;
    private spatula!: THREE.Group;

    // Eyes
    private leftEyeGroup!: THREE.Group;
    private rightEyeGroup!: THREE.Group;
    private leftEyePixels: THREE.Mesh[] = [];
    private rightEyePixels: THREE.Mesh[] = [];

    // Waveform mouth
    private mouthGroup!: THREE.Group;
    private waveformBars: THREE.Mesh[] = [];
    private waveformParticles!: THREE.Points;
    private wavePhase = 0;

    // Status lights on chest panel
    private statusLights: THREE.Mesh[] = [];

    // Main directional light (shadow caster) — kept as a field so quality tier
    // changes can adjust shadow map size / enablement without rebuilding.
    private mainLight!: THREE.DirectionalLight;

    // Cached PBR environment texture so quality tier "low" can null out
    // this.scene.environment and higher tiers can restore it.
    private envMap: THREE.Texture | null = null;

    // Animation state
    private isSpeaking = false;
    private jawOpenAmount = 0;
    private interruptionTime: number | null = null;

    // Eye-gaze + blink (idle only)
    private gazeTarget = new THREE.Vector2(0, 0);
    private currentGaze = new THREE.Vector2(0, 0);
    private nextBlinkAt = 0;
    private blinkStartedAt: number | null = null;
    private onMouseMove: ((e: MouseEvent) => void) | null = null;

    // Viseme tracking
    private currentMouthShape: MouthShape = "neutral";
    private previousMouthShape: MouthShape = "neutral";
    private shapeTransitionProgress = 1;
    private nextVisemeChange = 0;
    private lastIntensityRange = "low";

    constructor(container: HTMLElement) {
        super(container);

        // Adjust camera for the chef robot's proportions — pulled back for full scene
        this.camera.position.set(0, 3.5, 12);
        this.camera.lookAt(0, 2.2, 0);
        this.updateControlsTarget(0, 2.2, 0);

        this.buildKitchenBackground();
        this.buildRobot();

        // Track mouse position in canvas-local normalised coords [-1, 1].
        // Stored as a field so dispose() can remove it without leaking.
        this.onMouseMove = (e: MouseEvent) => {
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.gazeTarget.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
            this.gazeTarget.y = -((e.clientY - rect.top) / rect.height - 0.5) * 2;
        };
        this.renderer.domElement.addEventListener("mousemove", this.onMouseMove);

        this.setAnimationCallback(this.onAnimate.bind(this));
    }

    // =========================================================================
    // Public API (consumed by Avatar3DReactWrapper)
    // =========================================================================

    updateLipSync(audioLevel: number): void {
        this.jawOpenAmount = Math.min(audioLevel * 8, 1.0);
    }

    setSpeaking(speaking: boolean): void {
        this.isSpeaking = speaking;
        if (!speaking) {
            this.jawOpenAmount = 0;
            this.resetMouth();
            this.statusLights.forEach((l) => {
                (l.material as THREE.MeshStandardMaterial).color.setHex(this.accentColor);
            });
        } else {
            this.statusLights.forEach((l) => {
                (l.material as THREE.MeshStandardMaterial).color.setHex(0x00ff00);
            });
        }
    }

    setEyeColor(color: number): void {
        [...this.leftEyePixels, ...this.rightEyePixels].forEach((p) => {
            const mat = p.material as THREE.MeshBasicMaterial;
            mat.color.setHex(color);
        });
    }

    showInterruption(): void {
        this.interruptionTime = performance.now();
    }

    override dispose(): void {
        if (this.onMouseMove) {
            this.renderer.domElement.removeEventListener("mousemove", this.onMouseMove);
            this.onMouseMove = null;
        }
        super.dispose();
    }

    /**
     * Quality tier selector.
     *  - low:    no shadows, no environment map. Flat PBR only.
     *  - medium: soft shadows at 1024², env map on.
     *  - high:   soft shadows at 2048², env map on.
     */
    setQuality(tier: QualityTier): void {
        if (tier === "low") {
            this.renderer.shadowMap.enabled = false;
            this.scene.environment = null;
        } else if (tier === "medium") {
            this.renderer.shadowMap.enabled = true;
            this.mainLight.shadow.mapSize.set(1024, 1024);
            // Three.js requires regenerating the shadow map after resize.
            this.mainLight.shadow.map?.dispose();
            this.mainLight.shadow.map = null;
            this.scene.environment = this.envMap;
        } else {
            this.renderer.shadowMap.enabled = true;
            this.mainLight.shadow.mapSize.set(2048, 2048);
            this.mainLight.shadow.map?.dispose();
            this.mainLight.shadow.map = null;
            this.scene.environment = this.envMap;
        }
    }

    // =========================================================================
    // Build – Robot
    // =========================================================================

    private buildRobot(): void {
        this.robotGroup = new THREE.Group();
        this.robotGroup.position.y = 2.0;
        this.robotGroup.scale.set(1.6, 1.6, 1.6);

        this.buildHead();
        this.buildBody();
        this.buildArms();
        this.buildBase();

        this.robotGroup.add(this.head);
        this.scene.add(this.robotGroup);

        // All robot meshes cast + receive shadows. Lights (eye pixels, particle
        // points, emissive-only meshes) still render; they just cast nothing.
        this.robotGroup.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;
            }
        });

        // PBR room environment map gives MeshStandardMaterial metals a subtle
        // built-in reflection without requiring an external HDR asset.
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.envMap = pmrem.fromScene(RoomEnvironment(), 0.04).texture;
        this.scene.environment = this.envMap;
        pmrem.dispose();
    }

    // -- Head ----------------------------------------------------------------

    private buildHead(): void {
        const headGeo = new RoundedBoxGeometry(1.4, 1.3, 1.2, 6, 0.12);
        const headMat = new THREE.MeshStandardMaterial({
            color: this.robotColor,
            metalness: 0.85,
            roughness: 0.25,
        });
        this.head = new THREE.Mesh(headGeo, headMat);

        // Rounded-edge overlay
        const edgeGeo = new THREE.BoxGeometry(1.45, 1.35, 1.25);
        const edgeMat = new THREE.MeshStandardMaterial({
            color: this.robotColor,
            transparent: true,
            opacity: 0.3,
        });
        this.head.add(new THREE.Mesh(edgeGeo, edgeMat));

        // Cheek blush
        const cheekGeo = new THREE.CircleGeometry(0.15, 32);
        const cheekMat = new THREE.MeshBasicMaterial({
            color: 0xffb6c1,
            transparent: true,
            opacity: 0.6,
        });
        const leftCheek = new THREE.Mesh(cheekGeo, cheekMat);
        leftCheek.position.set(-0.5, -0.1, 0.62);
        this.head.add(leftCheek);
        const rightCheek = new THREE.Mesh(cheekGeo, cheekMat);
        rightCheek.position.set(0.5, -0.1, 0.62);
        this.head.add(rightCheek);

        // Face screen
        const screenGeo = new THREE.PlaneGeometry(1.3, 1.0);
        const screenMat = new THREE.MeshStandardMaterial({
            color: 0x000511,
            emissive: 0x001122,
            emissiveIntensity: 0.2,
            metalness: 0.2,
            roughness: 0.15,
            transparent: true,
            opacity: 0.9,
        });
        this.screen = new THREE.Mesh(screenGeo, screenMat);
        this.screen.position.set(0, 0, 0.61);
        this.head.add(this.screen);

        this.buildDigitalEyes();
        this.buildWaveformMouth();
        this.buildChefHat();
    }

    // -- Digital Eyes --------------------------------------------------------

    private buildDigitalEyes(): void {
        const pixelSize = 0.08;
        const pixelGeo = new THREE.PlaneGeometry(pixelSize * 1.2, pixelSize * 1.2);

        this.leftEyeGroup = new THREE.Group();
        this.leftEyeGroup.position.set(-0.35, 0.25, 0.65);
        this.head.add(this.leftEyeGroup);

        this.rightEyeGroup = new THREE.Group();
        this.rightEyeGroup.position.set(0.35, 0.25, 0.65);
        this.head.add(this.rightEyeGroup);

        const eyePattern = [
            [0, 1, 1, 1, 0],
            [1, 0, 1, 0, 1],
            [1, 1, 0, 1, 1],
            [0, 1, 1, 1, 0],
        ];

        for (let row = 0; row < eyePattern.length; row++) {
            for (let col = 0; col < eyePattern[row].length; col++) {
                if (eyePattern[row][col] !== 1) continue;

                const makeMat = (): THREE.MeshBasicMaterial =>
                    new THREE.MeshBasicMaterial({ color: this.defaultEyeColor });

                const lp = new THREE.Mesh(pixelGeo, makeMat());
                lp.position.set((col - 2) * pixelSize * 1.1, (1.5 - row) * pixelSize * 1.1, 0);
                this.leftEyeGroup.add(lp);
                this.leftEyePixels.push(lp);

                const rp = new THREE.Mesh(pixelGeo, makeMat());
                rp.position.set((col - 2) * pixelSize * 1.1, (1.5 - row) * pixelSize * 1.1, 0);
                this.rightEyeGroup.add(rp);
                this.rightEyePixels.push(rp);
            }
        }
    }

    // -- Waveform Mouth -----------------------------------------------------

    private buildWaveformMouth(): void {
        this.mouthGroup = new THREE.Group();
        this.mouthGroup.position.set(0, -0.25, 0.65);
        this.mouthGroup.renderOrder = 15;
        this.head.add(this.mouthGroup);

        // Background panel
        const bgGeo = new THREE.BoxGeometry(1.8, 0.35, 0.08);
        const bgMat = new THREE.MeshStandardMaterial({
            color: 0x0a0a0a,
            emissive: 0x001122,
            emissiveIntensity: 0.1,
        });
        const bg = new THREE.Mesh(bgGeo, bgMat);
        bg.position.z = -0.04;
        bg.renderOrder = 5;
        this.mouthGroup.add(bg);

        // Frame
        const frameGeo = new THREE.BoxGeometry(1.85, 0.4, 0.02);
        const frameMat = new THREE.MeshStandardMaterial({
            color: this.robotColor,
            metalness: 0.6,
            roughness: 0.3,
        });
        const frame = new THREE.Mesh(frameGeo, frameMat);
        frame.position.z = -0.05;
        this.mouthGroup.add(frame);

        // Bars
        const barCount = 24;
        const barWidth = 0.06;
        const barSpacing = 0.07;
        const maxBarHeight = 0.25;

        for (let i = 0; i < barCount; i++) {
            const barGeo = new THREE.BoxGeometry(barWidth, maxBarHeight, 0.02);
            const barMat = new THREE.MeshStandardMaterial({
                color: this.accentColor,
                emissive: this.accentColor,
                emissiveIntensity: 0.4,
                metalness: 0.6,
                roughness: 0.3,
            });
            const bar = new THREE.Mesh(barGeo, barMat);
            bar.position.set((i - barCount / 2 + 0.5) * barSpacing, 0, 0);
            bar.scale.y = 0.1;
            bar.renderOrder = 10;
            this.mouthGroup.add(bar);
            this.waveformBars.push(bar);
        }

        // Glow particles
        this.buildWaveformGlow();
    }

    private buildWaveformGlow(): void {
        const count = 30;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 2;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
            positions[i * 3 + 2] = 0.05 + Math.random() * 0.1;
            colors[i * 3] = 0.8;
            colors[i * 3 + 1] = 0.1;
            colors[i * 3 + 2] = 0.2;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.PointsMaterial({
            size: 0.025,
            vertexColors: true,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
        });

        this.waveformParticles = new THREE.Points(geo, mat);
        this.waveformParticles.visible = false;
        this.mouthGroup.add(this.waveformParticles);
    }

    // -- Chef Hat -----------------------------------------------------------

    private buildChefHat(): void {
        this.chefHat = new THREE.Group();
        this.chefHat.position.set(0, 0.95, 0);

        // Tall pleated cylinder
        const topGeo = new THREE.CylinderGeometry(0.55, 0.62, 2.0, 20);
        const topMat = new THREE.MeshStandardMaterial({
            color: this.hatColor,
            metalness: 0.0,
            roughness: 0.8,
            side: THREE.DoubleSide,
        });
        const hatTop = new THREE.Mesh(topGeo, topMat);
        hatTop.position.y = 0.6;
        this.chefHat.add(hatTop);

        // Pleats
        const pleatCount = 16;
        for (let i = 0; i < pleatCount; i++) {
            const angle = (i / pleatCount) * Math.PI * 2;
            const pleatGeo = new THREE.BoxGeometry(0.02, 2.0, 0.12);
            const pleatMat = new THREE.MeshStandardMaterial({
                color: 0xf8f8f8,
                metalness: 0.0,
                roughness: 0.85,
            });
            const pleat = new THREE.Mesh(pleatGeo, pleatMat);
            pleat.position.set(Math.cos(angle) * 0.58, 0.6, Math.sin(angle) * 0.58);
            pleat.rotation.y = angle;
            this.chefHat.add(pleat);
        }

        // Crown
        const crownGeo = new THREE.SphereGeometry(0.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2.5);
        const crownMat = new THREE.MeshStandardMaterial({
            color: this.hatColor,
            metalness: 0.0,
            roughness: 0.8,
        });
        const crown = new THREE.Mesh(crownGeo, crownMat);
        crown.position.y = 1.6;
        crown.scale.set(1.2, 0.8, 1.2);
        this.chefHat.add(crown);

        // Band
        const bandGeo = new THREE.CylinderGeometry(0.52, 0.54, 0.3, 32);
        const bandMat = new THREE.MeshStandardMaterial({
            color: this.hatColor,
            metalness: 0.0,
            roughness: 0.75,
        });
        const band = new THREE.Mesh(bandGeo, bandMat);
        band.position.y = -0.2;
        this.chefHat.add(band);

        // Decorative ring
        const decorGeo = new THREE.TorusGeometry(0.53, 0.02, 8, 32);
        const decorMat = new THREE.MeshStandardMaterial({
            color: 0xe0e0e0,
            metalness: 0.7,
            roughness: 0.3,
        });
        const decor = new THREE.Mesh(decorGeo, decorMat);
        decor.position.set(0, -0.05, 0);
        decor.rotation.x = Math.PI / 2;
        this.chefHat.add(decor);

        // Gold emblem
        const emblemGeo = new THREE.CircleGeometry(0.08, 16);
        const emblemMat = new THREE.MeshStandardMaterial({
            color: 0xffd700,
            emissive: 0xffd700,
            emissiveIntensity: 0.2,
            metalness: 1.0,
            roughness: 0.3,
        });
        const emblem = new THREE.Mesh(emblemGeo, emblemMat);
        emblem.position.set(0, -0.2, 0.55);
        this.chefHat.add(emblem);

        this.head.add(this.chefHat);
    }

    // -- Body ---------------------------------------------------------------

    private buildBody(): void {
        const bodyGeo = new RoundedBoxGeometry(1.0, 1.4, 0.8, 6, 0.08);
        const bodyMat = new THREE.MeshStandardMaterial({
            color: this.robotColor,
            metalness: 0.85,
            roughness: 0.25,
        });
        this.body = new THREE.Mesh(bodyGeo, bodyMat);
        this.body.position.set(0, -1.6, 0);
        this.head.add(this.body);

        this.buildApron();
        this.buildChestPanel();
    }

    private buildApron(): void {
        const apronGroup = new THREE.Group();

        const apronGeo = new THREE.PlaneGeometry(0.9, 1.2);
        const apronMat = new THREE.MeshStandardMaterial({
            color: this.apronColor,
            side: THREE.DoubleSide,
            metalness: 0.0,
            roughness: 0.85,
        });
        const apron = new THREE.Mesh(apronGeo, apronMat);
        apron.position.set(0, -0.2, 0.42);
        apronGroup.add(apron);

        // Straps
        const strapGeo = new THREE.BoxGeometry(0.05, 0.8, 0.05);
        const strapMat = new THREE.MeshStandardMaterial({
            color: this.apronColor,
            metalness: 0.0,
            roughness: 0.9,
        });
        const lStrap = new THREE.Mesh(strapGeo, strapMat);
        lStrap.position.set(-0.3, 0.5, 0.4);
        lStrap.rotation.z = -0.3;
        apronGroup.add(lStrap);

        const rStrap = new THREE.Mesh(strapGeo, strapMat);
        rStrap.position.set(0.3, 0.5, 0.4);
        rStrap.rotation.z = 0.3;
        apronGroup.add(rStrap);

        // Pocket
        const pocketGeo = new THREE.PlaneGeometry(0.3, 0.25);
        const pocketMat = new THREE.MeshStandardMaterial({
            color: 0xf5f5f5,
            side: THREE.DoubleSide,
        });
        const pocket = new THREE.Mesh(pocketGeo, pocketMat);
        pocket.position.set(0, -0.3, 0.43);
        apronGroup.add(pocket);

        // Wooden spoon in pocket
        const spoonHandleGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8);
        const spoonMat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
        const spoonHandle = new THREE.Mesh(spoonHandleGeo, spoonMat);
        spoonHandle.position.set(0.1, -0.1, 0.45);
        spoonHandle.rotation.z = 0.2;
        apronGroup.add(spoonHandle);

        const bowlGeo = new THREE.SphereGeometry(0.06, 8, 8);
        const bowl = new THREE.Mesh(bowlGeo, spoonMat);
        bowl.position.set(0.15, 0.08, 0.45);
        bowl.scale.set(1, 0.6, 0.4);
        apronGroup.add(bowl);

        // Waist ties
        const tieGeo = new THREE.BoxGeometry(0.4, 0.05, 0.05);
        const lTie = new THREE.Mesh(tieGeo, strapMat);
        lTie.position.set(-0.6, -0.2, 0.2);
        lTie.rotation.y = 0.5;
        apronGroup.add(lTie);
        const rTie = new THREE.Mesh(tieGeo, strapMat);
        rTie.position.set(0.6, -0.2, 0.2);
        rTie.rotation.y = -0.5;
        apronGroup.add(rTie);

        this.body.add(apronGroup);
    }

    private buildChestPanel(): void {
        const panelGeo = new THREE.PlaneGeometry(0.6, 0.4);
        const panelMat = new THREE.MeshStandardMaterial({
            color: 0x2d3748,
            metalness: 0.85,
            roughness: 0.25,
        });
        const panel = new THREE.Mesh(panelGeo, panelMat);
        panel.position.set(0, 0.5, 0.41);
        this.body.add(panel);

        for (let i = 0; i < 3; i++) {
            const lightGeo = new THREE.CircleGeometry(0.08, 16);
            const lightMat = new THREE.MeshStandardMaterial({
                color: this.accentColor,
                emissive: this.accentColor,
                emissiveIntensity: 0.8,
            });
            const light = new THREE.Mesh(lightGeo, lightMat);
            light.position.set(-0.3 + i * 0.3, 0, 0.01);
            panel.add(light);
            this.statusLights.push(light);
        }
    }

    // -- Arms ---------------------------------------------------------------

    private buildArms(): void {
        const upperGeo = new THREE.CylinderGeometry(0.12, 0.1, 0.8, 12);
        const lowerGeo = new THREE.CylinderGeometry(0.1, 0.08, 0.7, 12);
        const armMat = new THREE.MeshStandardMaterial({
            color: this.robotColor,
            metalness: 0.9,
            roughness: 0.2,
        });
        const jointGeo = new THREE.SphereGeometry(0.12, 16, 16);
        const jointMat = new THREE.MeshStandardMaterial({
            color: 0x2d3748,
            metalness: 0.9,
            roughness: 0.15,
        });
        const handGeo = new THREE.SphereGeometry(0.1, 12, 12);
        const handMat = new THREE.MeshStandardMaterial({
            color: 0x3a3a3a,
            metalness: 0.85,
            roughness: 0.25,
        });

        // --- Left arm (whisk) ---
        this.leftUpperArm = new THREE.Mesh(upperGeo, armMat);
        this.leftUpperArm.position.set(-0.85, 0.6, 0);
        this.leftUpperArm.rotation.z = Math.PI / 5;
        this.body.add(this.leftUpperArm);

        const leftElbow = new THREE.Mesh(jointGeo, jointMat);
        leftElbow.position.set(0, -0.4, 0);
        this.leftUpperArm.add(leftElbow);

        this.leftLowerArm = new THREE.Mesh(lowerGeo, armMat);
        this.leftLowerArm.position.set(0, -0.35, 0);
        this.leftLowerArm.rotation.z = -Math.PI / 8;
        leftElbow.add(this.leftLowerArm);

        const leftHand = new THREE.Mesh(handGeo, handMat);
        leftHand.position.set(0, -0.35, 0);
        this.leftLowerArm.add(leftHand);

        this.whisk = this.buildWhisk();
        leftHand.add(this.whisk);

        // --- Right arm (spatula) ---
        this.rightUpperArm = new THREE.Mesh(upperGeo, armMat);
        this.rightUpperArm.position.set(0.85, 0.6, 0);
        this.rightUpperArm.rotation.z = -Math.PI / 5;
        this.body.add(this.rightUpperArm);

        const rightElbow = new THREE.Mesh(jointGeo, jointMat);
        rightElbow.position.set(0, -0.4, 0);
        this.rightUpperArm.add(rightElbow);

        this.rightLowerArm = new THREE.Mesh(lowerGeo, armMat);
        this.rightLowerArm.position.set(0, -0.35, 0);
        this.rightLowerArm.rotation.z = Math.PI / 8;
        rightElbow.add(this.rightLowerArm);

        const rightHand = new THREE.Mesh(handGeo, handMat);
        rightHand.position.set(0, -0.35, 0);
        this.rightLowerArm.add(rightHand);

        this.spatula = this.buildSpatula();
        rightHand.add(this.spatula);
    }

    private buildWhisk(): THREE.Group {
        const g = new THREE.Group();
        g.position.set(0, -0.1, 0.05);
        g.rotation.x = -Math.PI / 6;
        g.rotation.z = Math.PI / 12;

        const handleGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.35, 8);
        const handleMat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
        const handle = new THREE.Mesh(handleGeo, handleMat);
        handle.position.y = -0.15;
        g.add(handle);

        const wireCount = 8;
        for (let i = 0; i < wireCount; i++) {
            const angle = (i / wireCount) * Math.PI * 2;
            const curve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(0, -0.3, 0),
                new THREE.Vector3(Math.cos(angle) * 0.06, -0.38, Math.sin(angle) * 0.06),
                new THREE.Vector3(Math.cos(angle) * 0.09, -0.48, Math.sin(angle) * 0.09),
                new THREE.Vector3(Math.cos(angle) * 0.07, -0.55, Math.sin(angle) * 0.07),
                new THREE.Vector3(0, -0.58, 0),
            ]);
            const wireGeo = new THREE.TubeGeometry(curve, 16, 0.006, 4, false);
            const wireMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0 });
            g.add(new THREE.Mesh(wireGeo, wireMat));
        }
        return g;
    }

    private buildSpatula(): THREE.Group {
        const g = new THREE.Group();
        g.position.set(0, -0.1, 0.05);
        g.rotation.x = -Math.PI / 8;
        g.rotation.z = -Math.PI / 12;

        const handleGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8);
        const handleMat = new THREE.MeshStandardMaterial({ color: 0x654321 });
        const handle = new THREE.Mesh(handleGeo, handleMat);
        handle.position.y = -0.2;
        g.add(handle);

        const bladeShape = new THREE.Shape();
        bladeShape.moveTo(-0.06, 0);
        bladeShape.lineTo(0.06, 0);
        bladeShape.lineTo(0.05, -0.12);
        bladeShape.lineTo(-0.05, -0.12);
        bladeShape.closePath();

        const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
            steps: 1,
            depth: 0.008,
            bevelEnabled: true,
            bevelThickness: 0.003,
            bevelSize: 0.003,
            bevelSegments: 2,
        });
        const bladeMat = new THREE.MeshStandardMaterial({
            color: 0xd3d3d3,
            metalness: 0.9,
            roughness: 0.15,
        });
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.set(0, -0.45, 0);
        blade.rotation.x = Math.PI / 2;
        g.add(blade);

        // Slots
        for (let i = 0; i < 3; i++) {
            const slotGeo = new THREE.BoxGeometry(0.03, 0.006, 0.015);
            const slotMat = new THREE.MeshBasicMaterial({
                color: 0x000000,
                transparent: true,
                opacity: 0.3,
            });
            const slot = new THREE.Mesh(slotGeo, slotMat);
            slot.position.set((i - 1) * 0.02, -0.48, 0.001);
            g.add(slot);
        }
        return g;
    }

    // -- Hover Base ---------------------------------------------------------

    private buildBase(): void {
        const baseGeo = new THREE.CylinderGeometry(0.8, 1.0, 0.3, 32);
        const baseMat = new THREE.MeshStandardMaterial({
            color: 0x2d3748,
            metalness: 0.8,
            roughness: 0.3,
        });
        this.base = new THREE.Mesh(baseGeo, baseMat);
        this.base.position.set(0, -1.0, 0);
        this.body.add(this.base);

        const ringGeo = new THREE.TorusGeometry(0.9, 0.1, 8, 32);
        const ringMat = new THREE.MeshStandardMaterial({
            color: 0x87ceeb,
            emissive: 0x87ceeb,
            emissiveIntensity: 0.3,
            transparent: true,
            opacity: 0.6,
        });
        this.hoverRing = new THREE.Mesh(ringGeo, ringMat);
        this.hoverRing.position.set(0, -0.2, 0);
        this.hoverRing.rotation.x = Math.PI / 2;
        this.base.add(this.hoverRing);
    }

    // =========================================================================
    // Build – Kitchen Background
    // =========================================================================

    private buildKitchenBackground(): void {
        // Gradient background via canvas texture
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext("2d")!;
        const grad = ctx.createLinearGradient(0, 0, 0, 512);
        grad.addColorStop(0, "#FFF8E7");
        grad.addColorStop(0.5, "#F5F5DC");
        grad.addColorStop(1, "#F0E68C");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 512);
        this.scene.background = new THREE.CanvasTexture(canvas);

        // Floor
        const floorGeo = new THREE.PlaneGeometry(30, 30);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0xf0f0f0,
            metalness: 0.0,
            roughness: 0.3,
            transparent: true,
            opacity: 0.8,
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -4;
        floor.receiveShadow = true;
        this.scene.add(floor);

        this.buildCheckerboard();

        // Back wall
        const wallGeo = new THREE.PlaneGeometry(30, 15);
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xfaf0e6 });
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(0, 3, -8);
        this.scene.add(wall);

        // Counter
        const counterGeo = new THREE.BoxGeometry(12, 1, 3);
        const counterMat = new THREE.MeshStandardMaterial({
            color: 0x8b7355,
            metalness: 0.0,
            roughness: 0.6,
        });
        const counter = new THREE.Mesh(counterGeo, counterMat);
        counter.position.set(0, -1.5, -4);
        counter.receiveShadow = true;
        this.scene.add(counter);

        // Counter top
        const topGeo = new THREE.BoxGeometry(12.2, 0.2, 3.2);
        const topMat = new THREE.MeshStandardMaterial({
            color: 0xf5f5f5,
            metalness: 0.1,
            roughness: 0.2,
        });
        const top = new THREE.Mesh(topGeo, topMat);
        top.position.set(0, -0.9, -4);
        top.receiveShadow = true;
        this.scene.add(top);

        this.buildStove();
        this.buildHangingUtensils();
        this.buildShelves();

        // Warm kitchen lighting
        this.scene.add(new THREE.AmbientLight(0xffe4b5, 0.6));

        const mainLight = new THREE.DirectionalLight(0xffdab9, 0.8);
        mainLight.position.set(2, 8, 4);
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.set(2048, 2048);
        mainLight.shadow.camera.near = 0.5;
        mainLight.shadow.camera.far = 30;
        mainLight.shadow.camera.left = -10;
        mainLight.shadow.camera.right = 10;
        mainLight.shadow.camera.top = 10;
        mainLight.shadow.camera.bottom = -10;
        mainLight.shadow.bias = -0.0005;
        this.mainLight = mainLight;
        this.scene.add(mainLight);

        const windowLight = new THREE.DirectionalLight(0xffffff, 0.4);
        windowLight.position.set(-5, 5, 2);
        this.scene.add(windowLight);

        const stoveGlow = new THREE.PointLight(0xff6b35, 0.3, 5);
        stoveGlow.position.set(0, -0.5, -3.5);
        this.scene.add(stoveGlow);
    }

    private buildCheckerboard(): void {
        const size = 1.5;
        const n = 10;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const geo = new THREE.PlaneGeometry(size, size);
                const mat = new THREE.MeshStandardMaterial({
                    color: (i + j) % 2 === 0 ? 0xffffff : 0x333333,
                    metalness: 0.05,
                    roughness: 0.3,
                });
                const tile = new THREE.Mesh(geo, mat);
                tile.rotation.x = -Math.PI / 2;
                tile.position.set(
                    (i - n / 2) * size + size / 2,
                    -2.99,
                    (j - n / 2) * size + size / 2
                );
                this.scene.add(tile);
            }
        }
    }

    private buildStove(): void {
        const stoveGeo = new THREE.BoxGeometry(3, 0.8, 2);
        const stoveMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50 });
        const stove = new THREE.Mesh(stoveGeo, stoveMat);
        stove.position.set(0, -0.5, -4);
        this.scene.add(stove);

        for (let i = 0; i < 4; i++) {
            const burnerGeo = new THREE.TorusGeometry(0.3, 0.1, 8, 16);
            const burnerMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c });
            const burner = new THREE.Mesh(burnerGeo, burnerMat);
            const x = (i % 2) * 0.8 - 0.4;
            const z = Math.floor(i / 2) * 0.8 - 3.6;
            burner.position.set(x, -0.05, z);
            burner.rotation.x = -Math.PI / 2;
            this.scene.add(burner);

            if (i === 0) {
                const flameGeo = new THREE.ConeGeometry(0.15, 0.3, 8);
                const flameMat = new THREE.MeshBasicMaterial({
                    color: 0xff4500,
                    transparent: true,
                    opacity: 0.8,
                });
                const flame = new THREE.Mesh(flameGeo, flameMat);
                flame.position.set(x, 0.15, z);
                this.scene.add(flame);
            }
        }

        // Oven door
        const doorGeo = new THREE.PlaneGeometry(2.8, 0.6);
        const doorMat = new THREE.MeshStandardMaterial({ color: 0x34495e });
        const door = new THREE.Mesh(doorGeo, doorMat);
        door.position.set(0, -0.5, -2.99);
        this.scene.add(door);

        // Handle
        const hGeo = new THREE.BoxGeometry(2.5, 0.08, 0.08);
        const hMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0 });
        const h = new THREE.Mesh(hGeo, hMat);
        h.position.set(0, -0.3, -2.95);
        this.scene.add(h);
    }

    private buildHangingUtensils(): void {
        const rackGeo = new THREE.BoxGeometry(4, 0.1, 0.1);
        const rackMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a });
        const rack = new THREE.Mesh(rackGeo, rackMat);
        rack.position.set(0, 2, -5);
        this.scene.add(rack);

        const hookGeo = new THREE.TorusGeometry(0.05, 0.02, 4, 8, Math.PI);
        const metalMat = new THREE.MeshStandardMaterial({ color: 0x808080 });

        const items: { type: string; x: number }[] = [
            { type: "pot", x: -1.5 },
            { type: "pan", x: -0.5 },
            { type: "pot", x: 0.5 },
            { type: "ladle", x: 1.5 },
        ];

        for (const item of items) {
            const hook = new THREE.Mesh(hookGeo, metalMat);
            hook.position.set(item.x, 1.95, -5);
            hook.rotation.z = Math.PI;
            this.scene.add(hook);

            if (item.type === "pot") {
                const potGeo = new THREE.CylinderGeometry(0.25, 0.22, 0.3, 16);
                const potMat = new THREE.MeshStandardMaterial({ color: 0x696969 });
                const pot = new THREE.Mesh(potGeo, potMat);
                pot.position.set(item.x, 1.7, -5);
                this.scene.add(pot);

                const phGeo = new THREE.TorusGeometry(0.08, 0.02, 4, 8, Math.PI);
                const ph = new THREE.Mesh(phGeo, metalMat);
                ph.position.set(item.x + 0.25, 1.7, -5);
                ph.rotation.z = -Math.PI / 2;
                this.scene.add(ph);
            } else if (item.type === "pan") {
                const panGeo = new THREE.CylinderGeometry(0.3, 0.28, 0.08, 16);
                const panMat = new THREE.MeshStandardMaterial({ color: 0x2c2c2c });
                const pan = new THREE.Mesh(panGeo, panMat);
                pan.position.set(item.x, 1.7, -5);
                this.scene.add(pan);

                const phGeo = new THREE.BoxGeometry(0.4, 0.05, 0.05);
                const ph = new THREE.Mesh(phGeo, panMat);
                ph.position.set(item.x + 0.35, 1.7, -5);
                ph.rotation.z = -0.2;
                this.scene.add(ph);
            } else if (item.type === "ladle") {
                const lhGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8);
                const lhMat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
                const lh = new THREE.Mesh(lhGeo, lhMat);
                lh.position.set(item.x, 1.6, -5);
                lh.rotation.z = 0.1;
                this.scene.add(lh);

                const bGeo = new THREE.SphereGeometry(0.08, 8, 8, 0, Math.PI);
                const b = new THREE.Mesh(bGeo, metalMat);
                b.position.set(item.x - 0.05, 1.35, -5);
                b.rotation.z = -Math.PI / 2;
                this.scene.add(b);
            }
        }
    }

    private buildShelves(): void {
        const shelfGeo = new THREE.BoxGeometry(3, 0.1, 0.8);
        const shelfMat = new THREE.MeshStandardMaterial({ color: 0x8b7355 });

        const lShelf = new THREE.Mesh(shelfGeo, shelfMat);
        lShelf.position.set(-5, 2.5, -6);
        this.scene.add(lShelf);

        const rShelf = new THREE.Mesh(shelfGeo, shelfMat);
        rShelf.position.set(5, 2.5, -6);
        this.scene.add(rShelf);

        this.addKitchenItems(-5, 2.7, -6);
        this.addKitchenItems(5, 2.7, -6);
    }

    private addKitchenItems(x: number, y: number, z: number): void {
        // Jar
        const jarGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.3, 12);
        const jarMat = new THREE.MeshStandardMaterial({
            color: 0xe6e6fa,
            transparent: true,
            opacity: 0.8,
        });
        const jar = new THREE.Mesh(jarGeo, jarMat);
        jar.position.set(x - 0.8, y, z);
        this.scene.add(jar);

        const lidGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.05, 12);
        const lidMat = new THREE.MeshStandardMaterial({ color: 0x8b7d6b });
        const lid = new THREE.Mesh(lidGeo, lidMat);
        lid.position.set(x - 0.8, y + 0.17, z);
        this.scene.add(lid);

        // Spice boxes
        const spiceColors = [0xcd853f, 0x8b4513, 0xdc143c];
        for (let i = 0; i < 3; i++) {
            const sGeo = new THREE.BoxGeometry(0.15, 0.25, 0.15);
            const sMat = new THREE.MeshStandardMaterial({ color: spiceColors[i] });
            const s = new THREE.Mesh(sGeo, sMat);
            s.position.set(x + i * 0.3, y, z);
            this.scene.add(s);
        }

        // Oil bottle
        const bGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.35, 8);
        const bMat = new THREE.MeshStandardMaterial({
            color: 0x556b2f,
            transparent: true,
            opacity: 0.7,
        });
        const b = new THREE.Mesh(bGeo, bMat);
        b.position.set(x + 0.8, y, z);
        this.scene.add(b);
    }

    // =========================================================================
    // Animation loop
    // =========================================================================

    private onAnimate(time: number): void {
        this.animateIdle(time);
        this.animateSpeech(time);
        this.animateInterruption(time);
        this.animateArms(time);
    }

    // -- Idle ---------------------------------------------------------------

    private animateIdle(time: number): void {
        // Gentle hover float
        const baseY = 2.0;
        this.robotGroup.position.y = baseY + Math.sin(time * 0.001) * 0.05;

        // Hover ring spin
        this.hoverRing.rotation.z += 0.02;

        // Chef hat wobble
        const wobble = Math.sin(time * 0.001) * 0.02;
        this.chefHat.rotation.z = wobble;
        this.chefHat.rotation.x = wobble * 0.5;

        // Status light blink
        this.statusLights.forEach((light, i) => {
            const t = time * 0.001 + i * 0.5;
            (light.material as THREE.MeshStandardMaterial).emissiveIntensity =
                0.3 + Math.sin(t * 3) * 0.5;
        });

        // Eye pixel scanning
        if (this.leftEyePixels.length > 0) {
            const scanIdx = Math.floor((time * 0.002) % this.leftEyePixels.length);
            this.leftEyePixels.forEach((p, i) => {
                (p.material as THREE.MeshBasicMaterial).opacity = i === scanIdx ? 1.0 : 0.7;
            });
            this.rightEyePixels.forEach((p, i) => {
                (p.material as THREE.MeshBasicMaterial).opacity = i === scanIdx ? 1.0 : 0.7;
            });
        }

        // Eye-gaze follows mouse (idle only — speaking keeps eyes forward)
        if (!this.isSpeaking) {
            this.currentGaze.lerp(this.gazeTarget, 0.08);
            const maxOffset = 0.04;
            this.leftEyeGroup.position.x = -0.35 + this.currentGaze.x * maxOffset;
            this.leftEyeGroup.position.y = 0.25 + this.currentGaze.y * maxOffset;
            this.rightEyeGroup.position.x = 0.35 + this.currentGaze.x * maxOffset;
            this.rightEyeGroup.position.y = 0.25 + this.currentGaze.y * maxOffset;
        }

        // Periodic blinks — squash eye groups on Y for ~120ms every 3–5s.
        if (this.blinkStartedAt === null) {
            if (this.nextBlinkAt === 0) {
                this.nextBlinkAt = time + 3000 + Math.random() * 2000;
            } else if (time >= this.nextBlinkAt) {
                this.blinkStartedAt = time;
            } else {
                this.leftEyeGroup.scale.y = 1;
                this.rightEyeGroup.scale.y = 1;
            }
        } else {
            const elapsed = time - this.blinkStartedAt;
            const duration = 120;
            if (elapsed >= duration) {
                this.leftEyeGroup.scale.y = 1;
                this.rightEyeGroup.scale.y = 1;
                this.blinkStartedAt = null;
                this.nextBlinkAt = time + 3000 + Math.random() * 2000;
            } else {
                // Triangular 1 → 0.1 → 1 profile.
                const half = duration / 2;
                const phase = elapsed < half ? elapsed / half : 1 - (elapsed - half) / half;
                const scale = 1 - phase * 0.9;
                this.leftEyeGroup.scale.y = scale;
                this.rightEyeGroup.scale.y = scale;
            }
        }
    }

    // -- Speech / waveform --------------------------------------------------

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private animateSpeech(_time: number): void {
        if (!this.isSpeaking) {
            // Gentle idle waveform
            this.waveformBars.forEach((bar, i) => {
                const idle = Math.sin(this.wavePhase * 0.3 + i * 0.4) * 0.05 + 0.08;
                bar.scale.y = idle;
                const mat = bar.material as THREE.MeshStandardMaterial;
                mat.emissiveIntensity = 0.2;
                mat.color.setHex(this.secondaryAccent);
                mat.emissive.setHex(this.secondaryAccent);
            });
            this.wavePhase += 0.02;
            this.waveformParticles.visible = false;
            return;
        }

        // Compute intensity from jawOpenAmount
        let intensity = Math.pow(this.jawOpenAmount, 0.7) * 1.5;
        intensity += (Math.random() - 0.5) * 0.1;
        intensity = Math.max(0, Math.min(1, intensity));

        // Viseme selection
        const now = Date.now();
        let range = "low";
        if (intensity > 0.7) range = "high";
        else if (intensity > 0.4) range = "medium";

        if (now > this.nextVisemeChange || this.lastIntensityRange !== range) {
            this.previousMouthShape = this.currentMouthShape;
            if (range === "high") this.currentMouthShape = pickRandom(HIGH_SHAPES);
            else if (range === "medium") this.currentMouthShape = pickRandom(MEDIUM_SHAPES);
            else this.currentMouthShape = pickRandom(LOW_SHAPES);

            this.nextVisemeChange = now + 150 + Math.random() * 150;
            this.shapeTransitionProgress = 0;
            this.lastIntensityRange = range;
        }
        this.shapeTransitionProgress = Math.min(this.shapeTransitionProgress + 0.15, 1.0);

        // Mouth group physical transforms
        const physics = this.getMouthShapePhysics(this.currentMouthShape);
        const baseScale = 1.0;
        this.mouthGroup.scale.y =
            baseScale + intensity * (2.5 - baseScale) * physics.heightMultiplier;
        this.mouthGroup.scale.x =
            baseScale + intensity * (1.4 - baseScale) * 0.5 * physics.widthMultiplier;
        this.mouthGroup.position.y =
            -0.25 + intensity * -0.15 * physics.dropMultiplier + physics.yOffset;
        this.mouthGroup.position.z =
            0.65 + intensity * 0.1 * physics.protrusionMultiplier + physics.zOffset;
        this.mouthGroup.rotation.z = physics.rotation * intensity * 0.5;

        // Waveform bars
        this.wavePhase += 0.15 + intensity * 0.3;

        this.waveformBars.forEach((bar, i) => {
            const shapeInf = this.getMouthShapeWaveform(this.currentMouthShape, i);
            const prevInf = this.getMouthShapeWaveform(this.previousMouthShape, i);
            const blended = prevInf + (shapeInf - prevInf) * this.shapeTransitionProgress;

            const centerDist = Math.abs(i - this.waveformBars.length / 2);
            const wo = centerDist * 0.3;

            const primary = Math.sin(this.wavePhase + wo) * 0.6 + 0.4;
            const secondary = Math.cos(this.wavePhase * 1.8 - wo * 1.5) * 0.4;
            const tertiary = Math.sin(this.wavePhase * 0.7 + wo * 0.8) * 0.3;
            const detail = Math.sin(this.wavePhase * 4 + i * 0.5) * 0.15;

            const wave = (primary + secondary + tertiary + detail) * blended;
            const h = wave * intensity * 1.2 + 0.08;
            const centerBoost = 1 + Math.exp(-centerDist * 0.5) * 0.8;
            const finalH = h * centerBoost;

            bar.scale.y = Math.max(0.02, Math.min(2.0, finalH));

            const mat = bar.material as THREE.MeshStandardMaterial;
            const shapeColor = this.getMouthShapeColor(this.currentMouthShape);
            const color = new THREE.Color();

            if (intensity > 0.6) {
                color.lerpColors(
                    new THREE.Color(this.accentColor),
                    new THREE.Color(shapeColor),
                    0.3
                );
                mat.emissiveIntensity = 0.9 + (finalH / 2.0) * 0.4;
            } else if (intensity > 0.3) {
                const mix = (intensity - 0.3) / 0.3;
                color.lerpColors(
                    new THREE.Color(this.secondaryAccent),
                    new THREE.Color(shapeColor),
                    mix * 0.5
                );
                mat.emissiveIntensity = 0.6 + intensity * 0.5 + (finalH / 2.0) * 0.2;
            } else {
                color.lerpColors(
                    new THREE.Color(this.secondaryAccent),
                    new THREE.Color(shapeColor),
                    0.2
                );
                mat.emissiveIntensity = 0.4 + intensity * 0.8 + (finalH / 2.0) * 0.1;
            }

            if (finalH > 1.5) {
                mat.emissiveIntensity = Math.min(mat.emissiveIntensity * 1.3, 2.0);
            }

            mat.color.copy(color);
            mat.emissive.copy(color);
        });

        // Particles
        this.waveformParticles.visible = intensity > 0.3;
        if (this.waveformParticles.visible) {
            const pos = this.waveformParticles.geometry.attributes.position.array as Float32Array;
            for (let i = 0; i < pos.length; i += 3) {
                pos[i + 1] += Math.sin(this.wavePhase + i) * 0.002;
                pos[i] += (Math.random() - 0.5) * 0.008;
                if (Math.abs(pos[i]) > 1) pos[i] = (Math.random() - 0.5) * 0.5;
            }
            this.waveformParticles.geometry.attributes.position.needsUpdate = true;
        }

        // Scanning line
        if (intensity > 0.3) {
            const scanIdx = Math.floor(
                ((this.wavePhase % (Math.PI * 2)) / (Math.PI * 2)) * this.waveformBars.length
            );
            [scanIdx, (scanIdx + 1) % this.waveformBars.length].forEach((idx) => {
                const mat = this.waveformBars[idx].material as THREE.MeshStandardMaterial;
                mat.emissiveIntensity = Math.min(mat.emissiveIntensity + 0.5, 3.0);
            });
        }
    }

    // -- Interruption -------------------------------------------------------

    private animateInterruption(time: number): void {
        if (this.interruptionTime === null) return;
        const elapsed = time - this.interruptionTime;
        if (elapsed < 500) {
            const shake = Math.sin(elapsed * 0.04) * 0.15 * (1 - elapsed / 500);
            this.head.rotation.y = shake;
        } else {
            this.head.rotation.y = 0;
            this.interruptionTime = null;
        }
    }

    // -- Arm idle -----------------------------------------------------------

    private animateArms(time: number): void {
        // Sticking with euler (not SLERP) — single-axis rotation doesn't
        // suffer gimbal lock, and widening amplitude to 0.15 rad is enough
        // visible motion without introducing quaternion math overhead.
        const t = time * 0.0005;
        this.leftLowerArm.rotation.x = Math.sin(t) * 0.15;
        this.rightLowerArm.rotation.x = Math.sin(t + Math.PI) * 0.15;
    }

    // -- Reset mouth --------------------------------------------------------

    private resetMouth(): void {
        this.waveformBars.forEach((bar) => {
            bar.scale.y = 0.1;
        });
        this.mouthGroup.scale.set(1, 1, 1);
        this.mouthGroup.position.set(0, -0.25, 0.65);
        this.mouthGroup.rotation.z = 0;
    }

    // =========================================================================
    // Viseme helpers
    // =========================================================================

    private getMouthShapeWaveform(shape: MouthShape, barIndex: number): number {
        const barCount = this.waveformBars.length;
        const center = barCount / 2;
        const dist = Math.abs(barIndex - center) / center;

        switch (shape) {
            case "open":
            case "ah":
                return 1.2 - dist * 0.3;
            case "oh":
                return 1.0 - Math.pow(dist, 1.5) * 0.4;
            case "ee":
                return 0.8 + dist * 0.6;
            case "oo":
                return 1.1 - Math.pow(dist, 2) * 0.5;
            case "wide":
                return 0.7 + Math.sin(dist * Math.PI) * 0.5;
            case "narrow":
                return 1.3 - dist * 0.7;
            case "mm":
                return 0.4 + Math.exp(-dist * 3) * 0.3;
            case "ff":
                return 0.6 + Math.sin(barIndex * 0.8) * 0.4;
            case "th":
                return 0.7 + Math.sin((barIndex - center) * 0.6) * 0.3;
            case "neutral":
            default:
                return 1.0 - dist * 0.2;
        }
    }

    private getMouthShapeColor(shape: MouthShape): number {
        switch (shape) {
            case "open":
            case "ah":
                return 0xff4444;
            case "oh":
                return 0xff6b35;
            case "ee":
                return 0x44ff44;
            case "oo":
                return 0x4444ff;
            case "wide":
                return 0xff44ff;
            case "narrow":
                return 0xffff44;
            case "mm":
                return 0x8844ff;
            case "ff":
                return 0x44ffff;
            case "th":
                return 0xff8844;
            case "neutral":
            default:
                return this.accentColor;
        }
    }

    private getMouthShapePhysics(shape: MouthShape): MouthShapePhysics {
        switch (shape) {
            case "open":
            case "ah":
                return {
                    heightMultiplier: 1.3,
                    widthMultiplier: 1.2,
                    dropMultiplier: 1.4,
                    protrusionMultiplier: 1.0,
                    yOffset: -0.02,
                    zOffset: 0.01,
                    rotation: 0,
                };
            case "oh":
                return {
                    heightMultiplier: 1.1,
                    widthMultiplier: 0.8,
                    dropMultiplier: 1.2,
                    protrusionMultiplier: 1.3,
                    yOffset: -0.01,
                    zOffset: 0.03,
                    rotation: 0,
                };
            case "ee":
                return {
                    heightMultiplier: 0.6,
                    widthMultiplier: 1.4,
                    dropMultiplier: 0.7,
                    protrusionMultiplier: 0.8,
                    yOffset: 0.01,
                    zOffset: -0.01,
                    rotation: 0.05,
                };
            case "oo":
                return {
                    heightMultiplier: 0.8,
                    widthMultiplier: 0.6,
                    dropMultiplier: 0.9,
                    protrusionMultiplier: 1.5,
                    yOffset: 0,
                    zOffset: 0.04,
                    rotation: 0,
                };
            case "wide":
                return {
                    heightMultiplier: 1.0,
                    widthMultiplier: 1.6,
                    dropMultiplier: 1.1,
                    protrusionMultiplier: 0.9,
                    yOffset: 0,
                    zOffset: 0,
                    rotation: 0.08,
                };
            case "narrow":
                return {
                    heightMultiplier: 1.2,
                    widthMultiplier: 0.5,
                    dropMultiplier: 1.0,
                    protrusionMultiplier: 1.1,
                    yOffset: 0,
                    zOffset: 0.02,
                    rotation: 0,
                };
            case "mm":
                return {
                    heightMultiplier: 0.3,
                    widthMultiplier: 0.7,
                    dropMultiplier: 0.2,
                    protrusionMultiplier: 0.6,
                    yOffset: 0.03,
                    zOffset: -0.02,
                    rotation: 0,
                };
            case "ff":
                return {
                    heightMultiplier: 0.4,
                    widthMultiplier: 1.0,
                    dropMultiplier: 0.5,
                    protrusionMultiplier: 0.8,
                    yOffset: 0.02,
                    zOffset: 0,
                    rotation: -0.03,
                };
            case "th":
                return {
                    heightMultiplier: 0.5,
                    widthMultiplier: 0.9,
                    dropMultiplier: 0.6,
                    protrusionMultiplier: 1.2,
                    yOffset: 0.01,
                    zOffset: 0.02,
                    rotation: 0.02,
                };
            case "neutral":
            default:
                return {
                    heightMultiplier: 1.0,
                    widthMultiplier: 1.0,
                    dropMultiplier: 1.0,
                    protrusionMultiplier: 1.0,
                    yOffset: 0,
                    zOffset: 0,
                    rotation: 0,
                };
        }
    }
}
