import * as THREE from "three";
import { Avatar3D } from "./Avatar3D";
import type { AvatarVariant } from "./AvatarVariant";

/**
 * Crystalline orb avatar with floating shards and sparkle ring.
 */
export class Avatar3DCrystal extends Avatar3D implements AvatarVariant {
    private coreMesh: THREE.Mesh;
    private coreMat: THREE.MeshPhongMaterial;
    private shards: THREE.Mesh[] = [];
    private shardBasePositions: THREE.Vector3[] = [];
    private sparkleRing: THREE.Points;
    private accentColor = new THREE.Color(0x88ccff);

    private audioLevel = 0;
    private isSpeaking = false;

    constructor(container: HTMLElement) {
        super(container);

        // Camera for crystal
        this.camera.position.set(0, 0, 3.5);
        this.camera.lookAt(0, 0, 0);
        this.updateControlsTarget(0, 0, 0);

        // Core octahedron
        const coreGeo = new THREE.OctahedronGeometry(1, 0);
        this.coreMat = new THREE.MeshPhongMaterial({
            color: 0x88ccff,
            emissive: 0x224466,
            shininess: 200,
            transparent: true,
            opacity: 0.85,
            flatShading: true,
        });
        this.coreMesh = new THREE.Mesh(coreGeo, this.coreMat);
        this.scene.add(this.coreMesh);

        // Floating shards
        const shardCount = 10;
        for (let i = 0; i < shardCount; i++) {
            const shardGeo = new THREE.ConeGeometry(0.1, 0.6 + Math.random() * 0.4, 4);
            const shardMat = new THREE.MeshPhongMaterial({
                color: 0xaaddff,
                emissive: 0x112244,
                transparent: true,
                opacity: 0.7,
                shininess: 150,
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

        // Extra directional light for crystal shimmer
        const rimLight = new THREE.DirectionalLight(0x88bbff, 0.5);
        rimLight.position.set(-2, 1, -3);
        this.scene.add(rimLight);

        this.setAnimationCallback(this.onAnimate.bind(this));
    }

    private onAnimate(time: number): void {
        const t = time * 0.001;
        const intensity = this.isSpeaking ? this.audioLevel : 0.02;

        // Core rotation — faster oscillation when speaking
        const rotSpeed = this.isSpeaking ? 0.6 + intensity * 0.8 : 0.3;
        this.coreMesh.rotation.y = t * rotSpeed;
        this.coreMesh.rotation.x =
            Math.sin(t * 0.2) * 0.1 + (this.isSpeaking ? Math.sin(t * 5) * intensity * 0.1 : 0);
        // Rhythmic scale pulsing tied to audio
        const corePulse = this.isSpeaking
            ? 1 + intensity * 0.2 + Math.sin(t * 8) * intensity * 0.06
            : 1 + Math.sin(t * 0.6) * 0.01;
        this.coreMesh.scale.setScalar(corePulse);

        // Emissive pulse — brighter flash on audio peaks
        const emissiveIntensity = 0.15 + intensity * 0.8;
        this.coreMat.emissive.copy(this.accentColor).multiplyScalar(emissiveIntensity);
        this.coreMat.opacity = 0.75 + intensity * 0.25;

        // Shards: burst outward when speaking, gentle float when idle
        this.shards.forEach((shard, i) => {
            const base = this.shardBasePositions[i];
            const dir = base.clone().normalize();
            const pulse = intensity * 0.8 * Math.sin(t * 5 + i * 0.8);
            const float = Math.sin(t * 0.5 + i * 0.7) * 0.05;
            shard.position.copy(base).addScaledVector(dir, pulse + float);

            // Rotate shards faster when speaking
            shard.rotation.z = t * (0.5 + intensity * 4);

            // Emissive on shards — bright flicker
            const shardMat = shard.material as THREE.MeshPhongMaterial;
            shardMat.emissive.copy(this.accentColor).multiplyScalar(emissiveIntensity * 0.8);
            shardMat.opacity = 0.5 + intensity * 0.5;
        });

        // Sparkle ring — faster spin and expansion when speaking
        const sparkleSpeed = this.isSpeaking ? 0.8 + intensity * 0.6 : 0.4;
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
        }
    }

    setEyeColor(hexColor: number): void {
        this.accentColor.set(hexColor);
        this.coreMat.color.set(hexColor);
    }
}
