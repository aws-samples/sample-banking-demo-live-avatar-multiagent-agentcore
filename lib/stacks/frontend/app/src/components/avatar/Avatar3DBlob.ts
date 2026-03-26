import * as THREE from "three";
import { Avatar3D } from "./Avatar3D";
import type { AvatarVariant } from "./AvatarVariant";

/**
 * Amorphic music-visualizer blob avatar.
 * Vertex-displaced icosahedron with particle cloud and orbiting rings.
 */
export class Avatar3DBlob extends Avatar3D implements AvatarVariant {
    private blobMesh: THREE.Mesh;
    private blobGeo: THREE.IcosahedronGeometry;
    private blobMat: THREE.MeshPhongMaterial;
    private originalPositions: Float32Array;
    private particleSystem: THREE.Points;
    private particlePositions: Float32Array;
    private particleOriginal: Float32Array;
    private rings: THREE.Mesh[] = [];

    private audioLevel = 0;
    private isSpeaking = false;
    private baseColor = new THREE.Color(0x4488ff);
    private hotColor = new THREE.Color(0xff6622);

    constructor(container: HTMLElement) {
        super(container);

        // Camera setup for blob
        this.camera.position.set(0, 0, 3.5);
        this.camera.lookAt(0, 0, 0);
        this.updateControlsTarget(0, 0, 0);

        // Core blob mesh
        this.blobGeo = new THREE.IcosahedronGeometry(1.2, 5);
        this.blobMat = new THREE.MeshPhongMaterial({
            color: 0x4488ff,
            emissive: 0x112244,
            transparent: true,
            opacity: 0.85,
            shininess: 80,
            wireframe: false,
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
            const ringMat = new THREE.MeshPhongMaterial({
                color: 0x6699ff,
                emissive: 0x224488,
                transparent: true,
                opacity: 0.4,
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
            (ring.material as THREE.MeshPhongMaterial).opacity = 0.3 + intensity * 0.5;
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
