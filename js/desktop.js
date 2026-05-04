// Desktop fallback controls so the project is testable without a VR headset.
// Provides:
//   - WASD movement (camera-relative)
//   - Mouse-look via PointerLock (click canvas to capture)
//   - Space = jump (small impulse against gravity)
//   - Shift = sprint
//   - Left-click = toggle grab/release
//   - Right-click = "squeeze" action
//
// Auto-disables when an XR session starts. The desktop pointer state is
// exposed as a synthetic "controller" object so main.js / vault.js can reuse
// the same raycaster/controller interaction logic.
//
// Fix:
//   - Shift sprint is kept.
//   - Holding an object no longer makes the player collision box larger.
//     This prevents getting stuck near the table/bin while carrying tools or loot.

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
        this._locked = false;

        // Synthetic "controller" object for reusing the XR codepath.
        // It behaves like a THREE.Object3D controller for raycasting.
        this.fakeController = new THREE.Object3D();
        this.fakeController.userData = {};

        // Callbacks assigned externally in main.js
        this.onTriggerStart = null;
        this.onTriggerEnd = null;
        this.onSqueeze = null;

        // Click canvas once to capture the mouse.
        this.dom.addEventListener('click', () => {
            if (this.enabled && !this.renderer.xr.isPresenting && !this._locked) {
                this.dom.requestPointerLock();
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this._locked = (document.pointerLockElement === this.dom);
            document.body.classList.toggle('aiming', this._locked);

            if (this._locked) {
                console.log('[desktop] pointer locked - desktop controls active');
            } else {
                console.log('[desktop] pointer unlocked - desktop controls inactive');
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!this._locked) return;

            this.yaw -= e.movementX * MOUSE_SENS;
            this.pitch -= e.movementY * MOUSE_SENS;

            const limit = Math.PI / 2 - 0.05;
            this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
        });

        window.addEventListener('keydown', (e) => {
            this.keys.add(e.key.toLowerCase());
        });

        window.addEventListener('keyup', (e) => {
            this.keys.delete(e.key.toLowerCase());
        });

        // Desktop interaction:
        // Left click toggles grab/release.
        // This is easier for testing than "hold mouse button to hold object."
        this.dom.addEventListener('mousedown', (e) => {
            if (!this._locked) return;

            if (e.button === 0) {
                e.preventDefault();

                if (this.fakeController.userData.selected) {
                    console.log('[desktop] left click -> release object');

                    if (this.onTriggerEnd) {
                        this.onTriggerEnd({ target: this.fakeController });
                    }
                } else {
                    console.log('[desktop] left click -> try grab object');

                    if (this.onTriggerStart) {
                        this.onTriggerStart({ target: this.fakeController });
                    }
                }
            } else if (e.button === 2) {
                e.preventDefault();

                console.log('[desktop] right click -> squeeze action');

                if (this.onSqueeze) {
                    this.onSqueeze();
                }
            }
        });

        // Do NOT release on mouseup anymore.
        // Releasing now happens on the next left-click.
        this.dom.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                e.preventDefault();
            }
        });

        this.dom.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // Auto-disable desktop controls when an XR session starts.
        this.renderer.xr.addEventListener('sessionstart', () => {
            this.enabled = false;

            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
        });

        this.renderer.xr.addEventListener('sessionend', () => {
            this.enabled = true;
        });

        // Start at the player spawn, inside the room, facing the vault.
        this.position = new THREE.Vector3(0, PLAYER_HEIGHT, 1);
    }

    update(dt) {
        if (!this.enabled || this.renderer.xr.isPresenting) return;

        const speed = (
            this.keys.has('shift')
                ? MOVE_SPEED * SPRINT_MULT
                : MOVE_SPEED
        ) * dt;

        // Camera-relative forward/right movement.
        const forward = new THREE.Vector3(
            -Math.sin(this.yaw),
            0,
            -Math.cos(this.yaw)
        );

        const right = new THREE.Vector3(
            Math.cos(this.yaw),
            0,
            -Math.sin(this.yaw)
        );

        const move = new THREE.Vector3();

        if (this.keys.has('w')) move.add(forward);
        if (this.keys.has('s')) move.sub(forward);
        if (this.keys.has('d')) move.add(right);
        if (this.keys.has('a')) move.sub(right);

        if (move.lengthSq() > 0) {
            move.normalize().multiplyScalar(speed);

            const px = this.position.x;
            const pz = this.position.z;

            // Try full movement first.
            // If blocked, slide along x or z.
            if (!this._collides(px + move.x, pz + move.z)) {
                this.position.x += move.x;
                this.position.z += move.z;
            } else if (!this._collides(px + move.x, pz)) {
                this.position.x += move.x;
            } else if (!this._collides(px, pz + move.z)) {
                this.position.z += move.z;
            }
        }

        // Jump + gravity.
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

        // Apply desktop position/rotation to camera.
        this.camera.position.copy(this.position);
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

        // Sync fake controller to camera so raycasts come from the crosshair.
        this.fakeController.position.copy(this.camera.position);
        this.fakeController.quaternion.copy(this.camera.quaternion);
        this.fakeController.updateMatrixWorld(true);
    }

    // AABB collision check.
    // Player is approximated as a vertical box centered at the camera position.
    _collides(x, z) {
        // IMPORTANT FIX:
        // Do not make the player radius larger while holding an object.
        // The held tool/loot should not become part of the player's body
        // collision, or movement gets stuck near the table/bin.
        const r = this.PLAYER_RADIUS;

        this._playerBox.min.set(x - r, 0.05, z - r);
        this._playerBox.max.set(x + r, PLAYER_HEIGHT, z + r);

        for (const b of this.blockers) {
            if (!b.visible) continue;
            if (b.userData?.isOpen) continue;

            this._tmpBox.setFromObject(b);

            if (this._playerBox.intersectsBox(this._tmpBox)) {
                return true;
            }
        }

        return false;
    }
}