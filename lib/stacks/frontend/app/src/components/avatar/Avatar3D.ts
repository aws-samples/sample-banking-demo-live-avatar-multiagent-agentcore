import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export class Avatar3D {
    protected scene: THREE.Scene;
    protected camera: THREE.PerspectiveCamera;
    protected renderer: THREE.WebGLRenderer;
    protected controls: OrbitControls;
    protected animationId: number | null = null;
    protected animationCallback: ((time: number) => void) | null = null;

    constructor(container: HTMLElement) {
        this.scene = new THREE.Scene();

        const width = container.clientWidth || 300;
        const height = container.clientHeight || 400;

        this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
        this.camera.position.set(0, 1, 4);
        this.camera.lookAt(0, 0.5, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        // Clamp DPR to 2 — full devicePixelRatio on 4K wastes GPU cycles
        // without visible gain.
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);

        // Orbit controls for touch, scroll, and zoom
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        this.controls.enableZoom = true;
        this.controls.enablePan = true;
        this.controls.enableRotate = true;
        this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
        this.controls.minDistance = 2;
        this.controls.maxDistance = 20;
        this.controls.target.set(0, 0.5, 0);
        this.controls.update();

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(2, 4, 3);
        this.scene.add(directionalLight);

        this.animate();
    }

    private animate = (): void => {
        this.animationId = requestAnimationFrame(this.animate);
        this.controls.update();
        if (this.animationCallback) {
            this.animationCallback(performance.now());
        }
        this.renderer.render(this.scene, this.camera);
    };

    resize(width: number, height: number): void {
        const aspect = width / height;
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        // Honour DPR changes (e.g. moving between monitors of different DPR).
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        // Give subclasses a chance to reframe their camera for the new aspect.
        this.onAspectChange?.(aspect);
    }

    /**
     * Subclass hook: reframe the camera when the container's aspect ratio
     * changes so the avatar fills its div consistently at any viewport.
     */
    protected onAspectChange?(aspect: number): void;

    /**
     * Shared camera-reframe helper. `baseZ` is the subclass' design-target
     * camera Z; `baseAspect` is the aspect at which that Z was authored.
     * Wider panels pull the camera in; very tall panels widen the FOV.
     */
    protected reframe(
        camera: THREE.PerspectiveCamera,
        baseZ: number,
        baseAspect: number,
        aspect: number
    ): void {
        const f = Math.min(Math.max(aspect / baseAspect, 0.6), 1.6);
        camera.position.z = baseZ / f;
        camera.fov = aspect < 0.9 ? Math.min(50 * (0.9 / aspect), 70) : 50;
        camera.updateProjectionMatrix();
    }

    /** Update the orbit controls target (call after changing camera.lookAt). */
    protected updateControlsTarget(x: number, y: number, z: number): void {
        this.controls.target.set(x, y, z);
        this.controls.update();
    }

    setAnimationCallback(fn: (time: number) => void): void {
        this.animationCallback = fn;
    }

    dispose(): void {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.controls.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
        this.scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
                object.geometry.dispose();
                if (Array.isArray(object.material)) {
                    object.material.forEach((m) => m.dispose());
                } else {
                    object.material.dispose();
                }
            }
        });
    }
}
