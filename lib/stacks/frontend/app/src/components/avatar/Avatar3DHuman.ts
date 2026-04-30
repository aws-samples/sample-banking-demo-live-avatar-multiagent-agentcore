/**
 * EXPERIMENTAL — Avatar3DHuman is not yet wired into the variant picker.
 *
 * To enable this variant:
 *   1. Download a Ready Player Me avatar GLB (MIT-compatible for commercial
 *      use) by generating one at https://readyplayer.me and exporting as GLB.
 *      Alternative: Microsoft RocketBox (https://github.com/microsoft/RocketBox,
 *      MIT). Both provide ARKit 52-blend-shape rigs compatible with the
 *      VISEME_TO_ARKIT map below.
 *   2. Drop the file at `public/avatars/chef.glb`.
 *   3. Extend `AvatarVariantName` in AvatarVariant.ts to include "human".
 *   4. Add a case in createAvatar() in Avatar3DReactWrapper.tsx.
 *   5. Add the button to the variant picker in AvatarInterface.tsx.
 */

import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { Avatar3D } from "./Avatar3D";
import type { AvatarVariant } from "./AvatarVariant";

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

/**
 * Maps our 11 internal viseme shapes to ARKit blend-shape target names as used
 * by Ready Player Me / RocketBox avatars. "neutral" intentionally maps to "" —
 * the driver sets all influences to 0 for that shape.
 */
const VISEME_TO_ARKIT: Record<MouthShape, string> = {
    open: "jawOpen",
    ah: "viseme_aa",
    oh: "viseme_O",
    ee: "viseme_I",
    oo: "viseme_U",
    wide: "mouthSmile",
    narrow: "mouthPucker",
    mm: "viseme_PP",
    ff: "viseme_FF",
    th: "viseme_TH",
    neutral: "",
};

export class Avatar3DHuman extends Avatar3D implements AvatarVariant {
    private loadedScene: THREE.Object3D | null = null;
    private morphMesh: THREE.Mesh | null = null;
    private influenceIndex: Record<string, number> = {};
    private currentShape: MouthShape = "neutral";
    private isSpeaking = false;
    private audioLevel = 0;

    constructor(container: HTMLElement) {
        super(container);

        this.camera.position.set(0, 1.5, 2.5);
        this.camera.lookAt(0, 1.4, 0);
        this.updateControlsTarget(0, 1.4, 0);

        const loader = new GLTFLoader();
        loader.load(
            "/avatars/chef.glb",
            (gltf) => {
                this.loadedScene = gltf.scene;
                this.scene.add(gltf.scene);

                // Find first mesh with morph targets. RPM heads usually have
                // the ARKit rig on the primary face mesh named "Wolf3D_Head".
                gltf.scene.traverse((obj) => {
                    if (
                        !this.morphMesh &&
                        obj instanceof THREE.Mesh &&
                        obj.morphTargetDictionary &&
                        obj.morphTargetInfluences
                    ) {
                        this.morphMesh = obj;
                        this.influenceIndex = { ...obj.morphTargetDictionary };
                    }
                });
            },
            undefined,
            (err) => {
                // Fail soft — the variant just renders empty if the GLB is
                // missing (expected on a fresh checkout before the user drops
                // chef.glb into public/avatars/).
                // eslint-disable-next-line no-console
                console.warn("[Avatar3DHuman] Failed to load chef.glb:", err);
            }
        );

        this.setAnimationCallback(this.onAnimate.bind(this));
    }

    updateLipSync(audioLevel: number): void {
        this.audioLevel = audioLevel;
        if (!this.morphMesh || !this.morphMesh.morphTargetInfluences) return;

        // Zero all tracked influences first so prior shape fades out.
        for (const name of Object.values(VISEME_TO_ARKIT)) {
            if (!name) continue;
            const idx = this.influenceIndex[name];
            if (idx !== undefined) {
                this.morphMesh.morphTargetInfluences[idx] = 0;
            }
        }

        const targetName = VISEME_TO_ARKIT[this.currentShape];
        if (!targetName) return;
        const idx = this.influenceIndex[targetName];
        if (idx === undefined) return;

        this.morphMesh.morphTargetInfluences[idx] = Math.min(audioLevel * 4, 1.0);
    }

    setSpeaking(isSpeaking: boolean): void {
        this.isSpeaking = isSpeaking;
        if (!isSpeaking) {
            this.currentShape = "neutral";
            this.updateLipSync(0);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setEyeColor(_color: number): void {
        // Human avatars use PBR eye textures — eye-color tinting is skipped
        // for now. Future: tweak material emissive on the eye mesh.
    }

    private onAnimate(_time: number): void {
        // Drive lip-sync continuously while audio is flowing.
        if (this.isSpeaking) {
            this.updateLipSync(this.audioLevel);
        }
    }

    override dispose(): void {
        if (this.loadedScene) {
            this.scene.remove(this.loadedScene);
            this.loadedScene.traverse((obj) => {
                if (obj instanceof THREE.Mesh) {
                    obj.geometry.dispose();
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach((m) => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
            });
            this.loadedScene = null;
            this.morphMesh = null;
        }
        super.dispose();
    }
}
