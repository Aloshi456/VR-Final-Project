// Vault unlock state machine.
//
// The unlock sequence is RANDOMIZED each session - the 3 stages
// (lockpick, hacker, drill) are shuffled, and the player must complete them
// in the order written on the note on the table.
//
// Progress is PROXIMITY-BASED: the player picks up a tool from the table,
// and bringing it close to the matching interaction target fills a meter.
// No trigger-hold required - just hold the tool near the target until the bar
// fills. Wrong tool, wrong stage, or no tool in hand = no progress.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Stage durations (seconds the tool must be held against its target)
const STAGE_DURATION = 4.0;

// Distance threshold (meters) - tool must be at least this close to target
const USE_DISTANCE = 0.4;

// Per-stage configuration. Each stage has:
//   id        - the interaction target's userData.interaction value
//   toolId    - the tool that must be held
//   toolLabel - human-readable name (shown on note + HUD)
//   targetLabel - human-readable name of the target (shown on note)
const STAGES = [
    { id: 'lock',   toolId: 'lockpick', toolLabel: 'LOCKPICK', targetLabel: 'KEYHOLE' },
    { id: 'keypad', toolId: 'hacker',   toolLabel: 'HACKER',   targetLabel: 'KEYPAD' },
    { id: 'bolt',   toolId: 'drill',    toolLabel: 'DRILL',    targetLabel: 'BOLT' },
];

export function generateRandomSequence() {
    // Fisher-Yates shuffle on a copy
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
        this.currentStep = 0;          // 0..3, 3 = unlocked
        this.progress = 0;             // 0..1 for the current step

        // Lookup by id
        this.targets = {
            lock:   roomBuild.lock,
            keypad: roomBuild.keypad,
            bolt:   roomBuild.bolt,
        };

        // Single progress bar - floats above the current target.
        // We move it as the player advances stages.
        this._progressBar = makeProgressBar(0xffaa22);
        this._progressBar.visible = false;
        roomBuild.lock.parent.add(this._progressBar);

        this._tmpVecA = new THREE.Vector3();
        this._tmpVecB = new THREE.Vector3();

        this._positionProgressBar();
    }

    getStageLabel() {
        if (this.currentStep >= this.sequence.length) return 'UNLOCKED';
        const next = this.sequence[this.currentStep];
        return `Step ${this.currentStep + 1}/${this.sequence.length}: ${next.toolLabel} on ${next.targetLabel}`;
    }

    getSequence() {
        return this.sequence;
    }

    // Per-frame update. controllers is an array; for each, we check what
    // (if anything) is held in controller.userData.selected. If it's a tool
    // with the right toolId for the current step, and it's near the target,
    // we tick the progress meter.
    update(dt, controllers) {
        if (this.currentStep >= this.sequence.length) {
            this._progressBar.visible = false;
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

            held.getWorldPosition(this._tmpVecB);
            const dist = this._tmpVecA.distanceTo(this._tmpVecB);
            if (dist < USE_DISTANCE) {
                closeWithCorrectTool = true;
                break;
            }
        }

        if (closeWithCorrectTool) {
            this.progress = Math.min(1, this.progress + dt / STAGE_DURATION);
        } else {
            // Slow decay so the player doesn't have to be perfectly steady,
            // but moving the tool away cancels meaningful progress over time.
            this.progress = Math.max(0, this.progress - dt * 0.2);
        }

        this._setBarFill(this._progressBar, this.progress);
        this._progressBar.visible = this.progress > 0.001;
        this._positionProgressBar();

        if (this.progress >= 1) {
            this._advanceStep();
        }
    }

    _advanceStep() {
        this.currentStep++;
        this.progress = 0;
        this._progressBar.visible = false;

        // Visual feedback on the just-completed target
        const justFinished = this.sequence[this.currentStep - 1];
        if (justFinished.id === 'lock') {
            // dim the keyhole
            this.targets.lock.material.color.setHex(0x335533);
        } else if (justFinished.id === 'keypad') {
            const led = this.targets.keypad.getObjectByName('keypadLED');
            if (led) led.material.color.setHex(0x33ff33);
        } else if (justFinished.id === 'bolt') {
            this.targets.bolt.material.color.setHex(0x335533);
        }

        if (this.currentStep >= this.sequence.length) {
            this._releaseDoor();
            if (this.onOpen) this.onOpen();
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
        // Park the bar above the target, in target's parent space
        const targetWorldPos = new THREE.Vector3();
        target.getWorldPosition(targetWorldPos);
        // Convert into the bar's parent's local space
        const parent = this._progressBar.parent;
        if (parent) {
            parent.worldToLocal(targetWorldPos);
        }
        targetWorldPos.y += 0.18;
        this._progressBar.position.copy(targetWorldPos);
    }

    _releaseDoor() {
        // Disable motor, push door open with a small impulse
        this.room.hinge.disableMotor();
        this.room.doorBody.wakeUp();
        this.room.doorBody.applyImpulse(
            new CANNON.Vec3(8, 0, -2),
            new CANNON.Vec3(0.8, 0, 0.1)
        );
        // Hide the door from the desktop blocker check so the player can
        // walk through. (DesktopController._collides skips invisible blockers.)
        // We don't want to actually hide the mesh; we use a userData flag
        // that the DesktopController checks instead.
        this.room.door.userData.isOpen = true;
    }

    // The duffel-bag drop-zone bounds (used by main.js to detect collected loot)
    getLootBagBounds() {
        if (!this.room.bag) return null;
        const box = new THREE.Box3().setFromObject(this.room.bag);
        box.expandByVector(new THREE.Vector3(0.1, 0.5, 0.1));
        return box;
    }
}

function makeProgressBar(color) {
    const group = new THREE.Group();
    const bg = new THREE.Mesh(
        new THREE.PlaneGeometry(0.2, 0.03),
        new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.75 })
    );
    group.add(bg);

    const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(0.19, 0.022),
        new THREE.MeshBasicMaterial({ color })
    );
    fill.name = 'fill';
    fill.position.z = 0.001;
    fill.scale.x = 0.001;
    group.add(fill);
    return group;
}

// Helper accessible on the instance via prototype binding
VaultStateMachine.prototype._setBarFill = function (bar, t) {
    const fill = bar.getObjectByName('fill');
    if (!fill) return;
    fill.scale.x = Math.max(0.001, t);
    fill.position.x = -0.095 + (t * 0.19) / 2;
};
