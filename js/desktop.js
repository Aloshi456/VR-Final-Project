// Desktop fallback controls so the project is testable without a VR headset.
// Provides:
//   - WASD movement (camera-relative)
//   - Mouse-look via PointerLock (click canvas to capture)
//   - Space = jump (small impulse against gravity)
//   - Shift = sprint
//   - Left-click = "trigger" (uses tool / grabs object the camera is looking at)
//   - Right-click = "squeeze" (cycle tool)
//
// Auto-disables when an XR session starts. The desktop pointer state is
// exposed as a synthetic "controller" object so main.js / vault.js can reuse
// the same raycaster setFromXRController-style API.

import * as THREE from 'three';

const MOVE_SPEED = 3.0;        // m/s
const SPRINT_MULT = 2.0;
const MOUSE_SENS = 0.0025;
const JUMP_VELOCITY = 4.0;
const GRAVITY = 9.82;
const PLAYER_HEIGHT = 1.6;

export class DesktopController {
    constructor(camera, renderer, domElement, blockers = []) {
        this.camera = camera;
        this.renderer = renderer;
        this.dom = domElement;
        this.enabled = true;
        this.blockers = blockers;
        this._tmpBox = new THREE.Box3();
        this._playerBox = new THREE.Box3();
        this.PLAYER_RADIUS = 0.3;

        this.keys = new Set();
        this.yaw = 0;
        this.pitch = 0;
        this.velocityY = 0;
        this.onGround = true;

        // Synthetic "controller" object for reusing the XR codepath.
        // It quacks like a THREE.Object3D for raycaster.setFromXRController:
        // setFromXRController() reads matrixWorld; we keep it in sync with the
        // camera every frame in update().
        this.fakeController = new THREE.Object3D();
        this.fakeController.userData = {};

        // Listeners
        this.dom.addEventListener('click', () => {
            if (this.enabled && !this.renderer.xr.isPresenting) {
                this.dom.requestPointerLock();
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this._locked = (document.pointerLockElement === this.dom);
            // Toggle the crosshair only while the player is actively aiming
            document.body.classList.toggle('aiming', this._locked);
        });

        document.addEventListener('mousemove', (e) => {
            if (!this._locked) return;
            this.yaw -= e.movementX * MOUSE_SENS;
            this.pitch -= e.movementY * MOUSE_SENS;
            const limit = Math.PI / 2 - 0.05;
            this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
        });

        window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
        window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

        // Mouse buttons -> trigger / squeeze callbacks (set externally)
        this.onTriggerStart = null;
        this.onTriggerEnd = null;
        this.onSqueeze = null;

        this.dom.addEventListener('mousedown', (e) => {
            if (!this._locked) return;
            if (e.button === 0 && this.onTriggerStart) {
                this.onTriggerStart({ target: this.fakeController });
            } else if (e.button === 2 && this.onSqueeze) {
                this.onSqueeze();
            }
        });
        this.dom.addEventListener('mouseup', (e) => {
            if (e.button === 0 && this.onTriggerEnd) {
                this.onTriggerEnd({ target: this.fakeController });
            }
        });
        this.dom.addEventListener('contextmenu', (e) => e.preventDefault());

        // Auto-disable when an XR session starts
        this.renderer.xr.addEventListener('sessionstart', () => {
            this.enabled = false;
            if (document.pointerLockElement) document.exitPointerLock();
        });
        this.renderer.xr.addEventListener('sessionend', () => {
            this.enabled = true;
        });

        // Start at the player spawn (inside the antechamber, facing the vault).
        // The room front wall is at z=2, so we sit at z=1 with breathing room.
        this.position = new THREE.Vector3(0, PLAYER_HEIGHT, 1);
    }

    update(dt) {
        if (!this.enabled || this.renderer.xr.isPresenting) return;

        const speed = (this.keys.has('shift') ? MOVE_SPEED * SPRINT_MULT : MOVE_SPEED) * dt;

        // Camera-relative forward/right (yaw only - pitch shouldn't tilt walking)
        const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

        const move = new THREE.Vector3();
        if (this.keys.has('w')) move.add(forward);
        if (this.keys.has('s')) move.sub(forward);
        if (this.keys.has('d')) move.add(right);
        if (this.keys.has('a')) move.sub(right);
        if (move.lengthSq() > 0) {
            move.normalize().multiplyScalar(speed);
            // Try the full move; if blocked, slide along each axis independently
            // so the player can scrape walls without getting stuck.
            const px = this.position.x;
            const pz = this.position.z;
            if (!this._collides(px + move.x, pz + move.z)) {
                this.position.x += move.x;
                this.position.z += move.z;
            } else if (!this._collides(px + move.x, pz)) {
                this.position.x += move.x;
            } else if (!this._collides(px, pz + move.z)) {
                this.position.z += move.z;
            }
            // else: fully blocked, no movement this frame
        }

        // Jump + gravity
        if (this.keys.has(' ') && this.onGround) {
            this.velocityY = JUMP_VELOCITY;
            this.onGround = false;
        }
        this.velocityY -= GRAVITY * dt;
        this.position.y += this.velocityY * dt;
        if (this.position.y <= PLAYER_HEIGHT) {
            this.position.y = PLAYER_HEIGHT;
            this.velocityY = 0;
            this.onGround = true;
        }

        // Apply to camera
        this.camera.position.copy(this.position);
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

        // Sync fake controller to camera so raycasts originate from the eye
        this.fakeController.position.copy(this.camera.position);
        this.fakeController.quaternion.copy(this.camera.quaternion);
        this.fakeController.updateMatrixWorld(true);
    }

    // AABB collision check: would the player capsule at (x, z) overlap any blocker?
    // Player is approximated as a vertical box centered at (x, PLAYER_HEIGHT/2, z).
    // If the player is holding something, we widen the radius so the held
    // object doesn't clip through walls.
    _collides(x, z) {
        const holding = !!this.fakeController.userData.selected;
        const r = this.PLAYER_RADIUS + (holding ? 0.3 : 0);
        this._playerBox.min.set(x - r, 0.05, z - r);
        this._playerBox.max.set(x + r, PLAYER_HEIGHT, z + r);
        for (const b of this.blockers) {
            if (!b.visible) continue;
            if (b.userData?.isOpen) continue;
            this._tmpBox.setFromObject(b);
            if (this._playerBox.intersectsBox(this._tmpBox)) return true;
        }
        return false;
    }
}
