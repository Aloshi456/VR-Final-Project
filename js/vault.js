// Vault unlock state machine.
//
// The unlock sequence is RANDOMIZED each session - the 3 stages
// (lockpick, hacker, drill) are shuffled, and the player must complete them
// in the order written on the note on the table.
//
// Progress is PROXIMITY-BASED: the player picks up a tool from the table,
// and bringing it close to the matching interaction target fills a meter.
// Wrong tool, wrong stage, or no tool in hand = no progress.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const STAGE_DURATION = 4.0;
const USE_DISTANCE = 0.85;

const RAY_USE_DISTANCE = 0.45;
const MAX_RAY_USE_RANGE = 1.3;

const DOOR_OPEN_SECONDS = 1.25;

const STAGES = [
    { id: 'lock', toolId: 'lockpick', toolLabel: 'LOCKPICK', targetLabel: 'KEYHOLE' },
    { id: 'keypad', toolId: 'hacker', toolLabel: 'HACKER', targetLabel: 'KEYPAD' },
    { id: 'bolt', toolId: 'drill', toolLabel: 'DRILL', targetLabel: 'BOLT' },
];

export function generateRandomSequence() {
    const seq = STAGES.slice();

    for (let i = seq.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [seq[i], seq[j]] = [seq[j], seq[i]];
    }

    return seq;
}

export class VaultStateMachine {
    constructor(roomBuild, sync, sequence, onOpen) {
        this.room = roomBuild;
        this.sync = sync;
        this.onOpen = onOpen;
        this.sequence = sequence;

        this.currentStep = 0;
        this.progress = 0;

        this.targets = {
            lock: roomBuild.lock,
            keypad: roomBuild.keypad,
            bolt: roomBuild.bolt,
        };

        this._progressBar = makeProgressBar(0xffaa22);
        this._progressBar.visible = false;

        const progressParent = roomBuild.progressParent || roomBuild.door?.parent || roomBuild.lock.parent;
        progressParent.add(this._progressBar);

        this._tmpVecA = new THREE.Vector3();
        this._tmpVecB = new THREE.Vector3();
        this._tmpVecC = new THREE.Vector3();
        this._tmpVecD = new THREE.Vector3();
        this._tmpMatrix = new THREE.Matrix4();

        this._doorOpening = false;
        this._doorOpenTime = 0;

        this._doorClosedRotationY = roomBuild.door?.userData?.closedRotationY || 0;
        this._doorOpenRotationY = roomBuild.door?.userData?.openRotationY || Math.PI * 0.68;

        this._positionProgressBar();
    }

    getStageLabel() {
        if (this.currentStep >= this.sequence.length) {
            return 'UNLOCKED';
        }

        const next = this.sequence[this.currentStep];

        return `Step ${this.currentStep + 1}/${this.sequence.length}: ${next.toolLabel} on ${next.targetLabel}`;
    }

    getSequence() {
        return this.sequence;
    }

    update(dt, controllers) {
        if (this.currentStep >= this.sequence.length) {
            this._progressBar.visible = false;

            if (this._doorOpening) {
                this._animateDoorOpen(dt);
            }

            return;
        }

        const stage = this.sequence[this.currentStep];
        const target = this.targets[stage.id];

        if (!target) return;

        target.getWorldPosition(this._tmpVecA);

        let closeWithCorrectTool = false;

        for (const ctl of controllers) {
            if (!ctl) continue;

            const held = ctl.userData?.selected;

            if (!held) continue;
            if (held.userData?.toolId !== stage.toolId) continue;

            if (this._isHeldToolCloseEnough(ctl, held, this._tmpVecA)) {
                closeWithCorrectTool = true;
                break;
            }
        }

        if (closeWithCorrectTool) {
            this.progress = Math.min(1, this.progress + dt / STAGE_DURATION);
        } else {
            this.progress = Math.max(0, this.progress - dt * 0.2);
        }

        this._setBarFill(this._progressBar, this.progress);
        this._progressBar.visible = this.progress > 0.001;
        this._positionProgressBar();

        if (this.progress >= 1) {
            this._advanceStep();
        }
    }

    _isHeldToolCloseEnough(controller, held, targetWorldPos) {
        held.getWorldPosition(this._tmpVecB);

        if (targetWorldPos.distanceTo(this._tmpVecB) < USE_DISTANCE) {
            return true;
        }

        const heldBox = new THREE.Box3().setFromObject(held);
        const closestPoint = heldBox.clampPoint(targetWorldPos, this._tmpVecC);

        if (targetWorldPos.distanceTo(closestPoint) < USE_DISTANCE) {
            return true;
        }

        this._tmpMatrix.identity().extractRotation(controller.matrixWorld);

        const rayOrigin = this._tmpVecB;
        const rayDir = this._tmpVecC;

        rayOrigin.setFromMatrixPosition(controller.matrixWorld);
        rayDir.set(0, 0, -1).applyMatrix4(this._tmpMatrix).normalize();

        const toTarget = this._tmpVecD.copy(targetWorldPos).sub(rayOrigin);

        const alongRay = THREE.MathUtils.clamp(
            toTarget.dot(rayDir),
            0,
            MAX_RAY_USE_RANGE
        );

        const closestOnRay = rayOrigin.clone().add(rayDir.multiplyScalar(alongRay));
        const rayDistance = closestOnRay.distanceTo(targetWorldPos);

        return rayDistance < RAY_USE_DISTANCE;
    }

    _advanceStep() {
        this.currentStep++;
        this.progress = 0;
        this._progressBar.visible = false;

        const justFinished = this.sequence[this.currentStep - 1];

        if (justFinished.id === 'lock') {
            this.targets.lock.material.color.setHex(0x335533);
        } else if (justFinished.id === 'keypad') {
            const led = this.targets.keypad.getObjectByName('keypadLED');

            if (led) {
                led.material.color.setHex(0x33ff33);
                led.material.emissive.setHex(0x229922);
            }
        } else if (justFinished.id === 'bolt') {
            this.targets.bolt.material.color.setHex(0x335533);
        }

        if (this.currentStep >= this.sequence.length) {
            this._releaseDoor();

            if (this.onOpen) {
                this.onOpen();
            }
        } else {
            this._positionProgressBar();
        }
    }

    forceAdvance() {
        if (this.currentStep < this.sequence.length) {
            this.progress = 1;
            this._advanceStep();
        }
    }

    _positionProgressBar() {
        if (this.currentStep >= this.sequence.length) return;

        const stage = this.sequence[this.currentStep];
        const target = this.targets[stage.id];

        if (!target) return;

        const targetWorldPos = new THREE.Vector3();

        target.getWorldPosition(targetWorldPos);

        targetWorldPos.y += 0.28;
        targetWorldPos.z += 0.14;

        const parent = this._progressBar.parent;

        if (parent) {
            parent.worldToLocal(targetWorldPos);
        }

        this._progressBar.position.copy(targetWorldPos);
        this._progressBar.rotation.set(0, 0, 0);
    }

    _releaseDoor() {
        if (this.room.door) {
            this.room.door.userData.isOpen = true;
        }

        if (this.room.doorBody) {
            this.room.doorBody.wakeUp();
            this.room.doorBody.velocity.set(0, 0, 0);
            this.room.doorBody.angularVelocity.set(0, 0, 0);
            this.room.doorBody.type = CANNON.Body.KINEMATIC;
            this.room.doorBody.mass = 0;
            this.room.doorBody.collisionResponse = false;
            this.room.doorBody.updateMassProperties();
        }

        if (this.room.hinge?.disableMotor) {
            this.room.hinge.disableMotor();
        }

        this._doorOpening = true;
        this._doorOpenTime = 0;
    }

    _animateDoorOpen(dt) {
        if (!this.room.door) return;

        this._doorOpenTime = Math.min(
            DOOR_OPEN_SECONDS,
            this._doorOpenTime + dt
        );

        const t = this._doorOpenTime / DOOR_OPEN_SECONDS;
        const eased = easeOutCubic(t);

        this.room.door.rotation.y = THREE.MathUtils.lerp(
            this._doorClosedRotationY,
            this._doorOpenRotationY,
            eased
        );

        if (this._doorOpenTime >= DOOR_OPEN_SECONDS) {
            this._doorOpening = false;
        }
    }

    getLootBagBounds() {
        if (!this.room.bag) return null;

        const box = new THREE.Box3().setFromObject(this.room.bag);

        // Larger, more forgiving drop zone.
        // This makes desktop mode reliable because the coin does not need to
        // land perfectly inside the exact visible box.
        box.expandByVector(new THREE.Vector3(0.35, 0.9, 0.35));

        // Make sure dropping slightly above the bin still counts.
        box.max.y += 0.45;

        // Make sure the bottom of the bin is included.
        box.min.y = Math.min(box.min.y, 0);

        return box;
    }
}

function makeProgressBar(color) {
    const group = new THREE.Group();

    const bg = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.06),
        new THREE.MeshBasicMaterial({
            color: 0x111111,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
        })
    );

    group.add(bg);

    const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(0.40, 0.045),
        new THREE.MeshBasicMaterial({
            color,
            side: THREE.DoubleSide,
        })
    );

    fill.name = 'fill';
    fill.position.z = 0.002;
    fill.scale.x = 0.001;

    group.add(fill);

    return group;
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

VaultStateMachine.prototype._setBarFill = function (bar, t) {
    const fill = bar.getObjectByName('fill');

    if (!fill) return;

    fill.scale.x = Math.max(0.001, t);
    fill.position.x = -0.20 + (t * 0.40) / 2;
};