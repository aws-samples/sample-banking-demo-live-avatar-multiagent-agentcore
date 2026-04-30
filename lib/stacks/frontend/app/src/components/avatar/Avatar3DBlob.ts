import * as THREE from "three";
import { RoomEnvironment } from "three-stdlib";
import { Avatar3D } from "./Avatar3D";
import type { AvatarVariant } from "./AvatarVariant";

/**
 * Amorphic music-visualizer blob avatar.
 * Vertex-displaced icosahedron with particle cloud and orbiting rings.
 */
export class Avatar3DBlob extends Avatar3D implements AvatarVariant {
    private blobMesh: THREE.Mesh;
    private blobGeo: THREE.IcosahedronGeometry;
    private blobMat: THREE.MeshStandardMaterial;
    private originalPositions: Float32Array;
    private particleSystem: THREE.Points;
    private particlePositions: Float32Array;
    private particleOriginal: Float32Array;
    private rings: THREE.Mesh[] = [];

    private audioLevel = 0;
    private isSpeaking = false;
    private baseColor = new THREE.Color(0x3ab0d8); // teal-aqua, reads "friendly"
    private hotColor = new THREE.Color(0xff7a4a); // warm coral for speech peaks

    constructor(container: HTMLElement) {
        super(container);

        // Camera — framed a hair closer so the blob fills the canvas without
        // getting clipped by vertex displacement at high audio levels.
        this.camera.position.set(0, 0, 3.2);
        this.camera.lookAt(0, 0, 0);
        this.updateControlsTarget(0, 0, 0);

        // ACES tone-mapping + sRGB output so the emissive bloom reads as light
        // rather than saturated pixels.
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        // Radial gradient background via canvas texture so the blob is
        // centred in a soft halo rather than floating in flat transparency.
        const bg = document.createElement("canvas");
        bg.width = 512;
        bg.height = 512;
        const ctx = bg.getContext("2d")!;
        const grad = ctx.createRadialGradient(256, 256, 80, 256, 256, 360);
        grad.addColorStop(0, "#1a2f4a");
        grad.addColorStop(1, "#050812");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 512);
        this.scene.background = new THREE.CanvasTexture(bg);

        // PBR env map for metallic shimmer on the blob surface.
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(RoomEnvironment(), 0.04).texture;
        pmrem.dispose();

        // Core blob mesh — PBR with subtle metalness so the ring lights and
        // env map catch across the displaced surface.
        this.blobGeo = new THREE.IcosahedronGeometry(1.2, 5);
        this.blobMat = new THREE.MeshStandardMaterial({
            color: this.baseColor,
            emissive: this.baseColor,
            emissiveIntensity: 0.15,
            metalness: 0.6,
            roughness: 0.25,
            transparent: true,
            opacity: 0.9,
        });
        this.blobMesh = new THREE.Mesh(this.blobGeo, this.blobMat);
        this.scene.add(this.blobMesh);

        // Store original vertex positions for displacement
        const posAttr = this.blobGeo.getAttribute("position");
        this.originalPositions = new Float32Array(posAttr.array.length);
        this.originalPositions.set(posAttr.array as Float32Array);

        // Particle cloud
        const particleCount = 500;
        const particleGeo = new THREE.BufferGeometry();
        this.particlePositions = new Float32Array(particleCount * 3);
        this.particleOriginal = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount; i++) {
            const phi = Math.acos(2 * Math.random() - 1);
            const theta = Math.random() * Math.PI * 2;
            const r = 1.5 + Math.random() * 0.5;
            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.sin(phi) * Math.sin(theta);
            const z = r * Math.cos(phi);
            this.particlePositions[i * 3] = x;
            this.particlePositions[i * 3 + 1] = y;
            this.particlePositions[i * 3 + 2] = z;
            this.particleOriginal[i * 3] = x;
            this.particleOriginal[i * 3 + 1] = y;
            this.particleOriginal[i * 3 + 2] = z;
        }
        particleGeo.setAttribute("position", new THREE.BufferAttribute(this.particlePositions, 3));
        const particleMat = new THREE.PointsMaterial({
            size: 0.03,
            transparent: true,
            opacity: 0.6,
            color: 0x88bbff,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        this.particleSystem = new THREE.Points(particleGeo, particleMat);
        this.scene.add(this.particleSystem);

        // Orbiting rings
        for (let i = 0; i < 3; i++) {
            const ringGeo = new THREE.TorusGeometry(1.6 + i * 0.2, 0.01, 8, 64);
            const ringMat = new THREE.MeshStandardMaterial({
                color: 0x6ecfe8,
                emissive: 0x2a6a88,
                emissiveIntensity: 0.6,
                metalness: 0.3,
                roughness: 0.3,
                transparent: true,
                opacity: 0.45,
            });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = Math.PI / 3 + i * 0.4;
            ring.rotation.y = i * 0.5;
            this.scene.add(ring);
            this.rings.push(ring);
        }

        this.setAnimationCallback(this.onAnimate.bind(this));
    }

    private onAnimate(time: number): void {
        const t = time * 0.001;
        const intensity = this.isSpeaking ? this.audioLevel : 0.05;

        // Vertex displacement — dramatic when speaking
        const posAttr = this.blobGeo.getAttribute("position");
        const arr = posAttr.array as Float32Array;
        const displaceMult = this.isSpeaking ? 0.8 : 0.3;
        const freqBoost = this.isSpeaking ? 3.0 : 1.2;
        for (let i = 0; i < arr.length; i += 3) {
            const ox = this.originalPositions[i];
            const oy = this.originalPositions[i + 1];
            const oz = this.originalPositions[i + 2];
            const d =
                Math.sin(ox * 2.5 + t * freqBoost) *
                Math.sin(oy * 3.0 + t * (freqBoost * 1.25)) *
                Math.sin(oz * 2.0 + t * (freqBoost * 0.7)) *
                intensity *
                displaceMult;
            const len = Math.sqrt(ox * ox + oy * oy + oz * oz);
            const nx = ox / len;
            const ny = oy / len;
            const nz = oz / len;
            arr[i] = ox + nx * d;
            arr[i + 1] = oy + ny * d;
            arr[i + 2] = oz + nz * d;
        }
        posAttr.needsUpdate = true;
        this.blobGeo.computeVertexNormals();

        // Color reactivity — shift strongly toward hot color when speaking
        const color = new THREE.Color();
        color.lerpColors(this.baseColor, this.hotColor, intensity * 1.5);
        this.blobMat.color.copy(color);
        this.blobMat.emissive.copy(color).multiplyScalar(0.15 + intensity * 0.45);

        // Breathing scale — exaggerated pulsing when speaking
        const breathe = 1 + Math.sin(t * 0.8) * 0.02;
        const speakPulse = this.isSpeaking
            ? 1 + intensity * 0.25 + Math.sin(t * 6) * intensity * 0.08
            : 1;
        this.blobMesh.scale.setScalar(breathe * speakPulse);

        // Particle drift outward when speaking
        const pArr = this.particlePositions;
        const drift = 1 + intensity * 0.8;
        const jitter = this.isSpeaking ? 0.06 : 0.02;
        for (let i = 0; i < pArr.length; i += 3) {
            const ox = this.particleOriginal[i];
            const oy = this.particleOriginal[i + 1];
            const oz = this.particleOriginal[i + 2];
            pArr[i] = ox * drift + Math.sin(t * 2 + i) * jitter;
            pArr[i + 1] = oy * drift + Math.cos(t * 2 + i * 0.7) * jitter;
            pArr[i + 2] = oz * drift + Math.sin(t + i * 1.3) * jitter;
        }
        this.particleSystem.geometry.getAttribute("position").needsUpdate = true;
        (this.particleSystem.material as THREE.PointsMaterial).opacity = 0.3 + intensity * 0.7;
        (this.particleSystem.material as THREE.PointsMaterial).size = 0.03 + intensity * 0.03;

        // Ring animation — spin faster and expand more when speaking
        this.rings.forEach((ring, i) => {
            const spinSpeed = this.isSpeaking ? 0.6 + i * 0.3 : 0.2 + i * 0.1;
            ring.rotation.z = t * spinSpeed;
            const ringScale = 1 + intensity * 0.5;
            ring.scale.setScalar(ringScale);
            (ring.material as THREE.MeshStandardMaterial).opacity = 0.3 + intensity * 0.5;
        });

        // Rotation — wobble when speaking
        this.blobMesh.rotation.y =
            t * 0.15 + (this.isSpeaking ? Math.sin(t * 4) * intensity * 0.15 : 0);
        this.particleSystem.rotation.y = -t * 0.1;
    }

    updateLipSync(audioLevel: number): void {
        this.audioLevel = audioLevel;
    }

    setSpeaking(isSpeaking: boolean): void {
        this.isSpeaking = isSpeaking;
        if (!isSpeaking) {
            this.audioLevel = 0;
        }
    }

    setEyeColor(hexColor: number): void {
        this.baseColor.set(hexColor);
    }
}
