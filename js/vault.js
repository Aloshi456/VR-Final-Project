// Vault unlock state machine.
//
// Stages (Category A: custom interaction / system feature):
//   1. LOCKED         - default. Player must use lockpick on the lock cylinder.
//   2. PICK_PROGRESS  - holding trigger w/ lockpick aimed at lock fills a meter.
//   3. PICKED         - lockpick stage complete; LED on keypad turns yellow.
//   4. KEYPAD_ACTIVE  - hacker tool aimed at keypad runs a "decryption" timer.
//   5. KEYPAD_BYPASSED - keypad cracked; bolt becomes drillable.
//   6. DRILLING       - drill aimed at bolt fills final meter.
//   7. UNLOCKED       - hinge released; door swings open under physics.
//
// The state machine exposes:
//   - tryUseTool(tool, raycaster, controller)   on trigger press
//   - update(dt, ...)                            for held-trigger progress
//   - getStageLabel()                            for HUD
//   - getLootBagBounds()                         for collection check
//   - forceAdvance()                             dev shortcut

import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const STAGE = {
    LOCKED: 'LOCKED',
    PICKED: 'PICKED',
    KEYPAD_BYPASSED: 'KEYPAD BYPASSED',
    UNLOCKED: 'UNLOCKED',
};

// How long the player must hold a tool against its target (seconds)
const PICK_DURATION = 4.0;
const HACK_DURATION = 5.0;
const DRILL_DURATION = 3.5;

// Max distance the controller's ray must be within for the use to register
const MAX_USE_DIST = 1.2;

export class VaultStateMachine {
    constructor(roomBuild, sync, onOpen) {
        this.room = roomBuild;
        this.sync = sync;
        this.onOpen = onOpen;
        this.stage = STAGE.LOCKED;

        // Held-trigger progress (0..1)
        this.pickProgress = 0;
        this.hackProgress = 0;
        this.drillProgress = 0;

        // While trigger is held with the right tool aimed at the right target
        this._activeUse = null; // { tool, controller, target }

        // Progress bars (3 stacked rings above each interaction target)
        this._pickBar = makeProgressBar(0xff6633);
        this._pickBar.position.copy(this.room.lock.position).add(new THREE.Vector3(0, 0.18, 0));
        this.room.lock.parent.add(this._pickBar);

        this._hackBar = makeProgressBar(0x33ff66);
        this._hackBar.position.copy(this.room.keypad.position).add(new THREE.Vector3(0, 0.32, 0));
        this.room.keypad.parent.add(this._hackBar);

        this._drillBar = makeProgressBar(0xffaa22);
        this._drillBar.position.copy(this.room.bolt.position).add(new THREE.Vector3(0, 0.18, 0));
        this.room.bolt.parent.add(this._drillBar);

        this._setBarFill(this._pickBar, 0);
        this._setBarFill(this._hackBar, 0);
        this._setBarFill(this._drillBar, 0);
    }

    getStageLabel() { return this.stage; }

    // Called on selectstart. Returns true if the trigger press was consumed
    // by the vault (so main.js doesn't also try to grab loot).
    tryUseTool(tool, raycaster, controller) {
        const target = this._raycastTarget(raycaster);
        if (!target) return false;
        if (!this._isToolValid(tool.id, target)) return false;
        this._activeUse = { tool, controller, targetName: target.userData.interaction };
        return true;
    }

    // Per-frame: drain the appropriate progress meter while trigger is held
    // and the ray still points at the right thing.
    update(dt, raycaster, c1, c2, toolSystem) {
        if (!this._activeUse) {
            // Decay progress bars slightly so a fumbled attempt doesn't snap back to 0 instantly
            this.pickProgress = Math.max(0, this.pickProgress - dt * 0.15);
            this.hackProgress = Math.max(0, this.hackProgress - dt * 0.15);
            this.drillProgress = Math.max(0, this.drillProgress - dt * 0.15);
            this._refreshBars();
            this._stepDoorSwing(dt);
            return;
        }

        // Validate the use is still going - controller still pointing at target?
        const ctl = this._activeUse.controller;
        if (!ctl) { this._endUse(); return; }
        // Generic ray-from-controller (works for XR controllers AND the
        // desktop fake controller from desktop.js).
        const m = new THREE.Matrix4().identity().extractRotation(ctl.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(ctl.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(m);
        const target = this._raycastTarget(raycaster);
        const validNow = target && target.userData.interaction === this._activeUse.targetName
            && this._isToolValid(this._activeUse.tool.id, target);

        if (!validNow) {
            this._endUse();
            return;
        }

        // Tick the right meter
        switch (this._activeUse.targetName) {
            case 'lock':
                this.pickProgress = Math.min(1, this.pickProgress + dt / PICK_DURATION);
                if (this.pickProgress >= 1 && this.stage === STAGE.LOCKED) this._advanceTo(STAGE.PICKED);
                break;
            case 'keypad':
                this.hackProgress = Math.min(1, this.hackProgress + dt / HACK_DURATION);
                if (this.hackProgress >= 1 && this.stage === STAGE.PICKED) this._advanceTo(STAGE.KEYPAD_BYPASSED);
                break;
            case 'bolt':
                this.drillProgress = Math.min(1, this.drillProgress + dt / DRILL_DURATION);
                if (this.drillProgress >= 1 && this.stage === STAGE.KEYPAD_BYPASSED) this._advanceTo(STAGE.UNLOCKED);
                break;
        }
        this._refreshBars();
        this._stepDoorSwing(dt);
    }

    // Called on selectend
    endUse() { this._endUse(); }
    _endUse() { this._activeUse = null; }

    // ----- Stage transitions -----
    _advanceTo(stage) {
        this.stage = stage;
        if (stage === STAGE.PICKED) {
            const led = this.room.keypad.getObjectByName('keypadLED');
            if (led) led.material.color.setHex(0xffcc33);
        }
        if (stage === STAGE.KEYPAD_BYPASSED) {
            const led = this.room.keypad.getObjectByName('keypadLED');
            if (led) led.material.color.setHex(0x33ff33);
            // Color the bolt red to signal "drill me"
            this.room.bolt.material.color.setHex(0xcc4422);
        }
        if (stage === STAGE.UNLOCKED) {
            this._releaseDoor();
            if (this.onOpen) this.onOpen();
        }
    }

    forceAdvance() {
        const order = [STAGE.LOCKED, STAGE.PICKED, STAGE.KEYPAD_BYPASSED, STAGE.UNLOCKED];
        const i = order.indexOf(this.stage);
        if (i < order.length - 1) this._advanceTo(order[i + 1]);
    }

    _releaseDoor() {
        // Disable motor, push the door open with a small impulse, and let
        // physics + hinge handle the swing.
        this.room.hinge.disableMotor();
        this.room.doorBody.wakeUp();
        this.room.doorBody.applyImpulse(
            new CANNON.Vec3(8, 0, -2),
            new CANNON.Vec3(0.8, 0, 0.1)
        );
    }

    _stepDoorSwing(dt) {
        // No-op - hinge constraint + impulse handles the swing. Hook left
        // here so the team can add a creak sound effect or auto-stop angle.
    }

    // ----- Validation helpers -----
    _isToolValid(toolId, target) {
        const i = target.userData.interaction;
        if (i === 'lock' && toolId === 'lockpick') return this.stage === STAGE.LOCKED;
        if (i === 'keypad' && toolId === 'hacker') return this.stage === STAGE.PICKED;
        if (i === 'bolt' && toolId === 'drill') return this.stage === STAGE.KEYPAD_BYPASSED;
        return false;
    }

    _raycastTarget(raycaster) {
        const targets = [this.room.lock, this.room.keypad, this.room.bolt];
        const hits = raycaster.intersectObjects(targets, true);
        if (hits.length === 0) return null;
        if (hits[0].distance > MAX_USE_DIST) return null;
        // Walk up to find the object with userData.interaction
        let o = hits[0].object;
        while (o && !o.userData.interaction) o = o.parent;
        return o;
    }

    _refreshBars() {
        this._setBarFill(this._pickBar, this.pickProgress);
        this._setBarFill(this._hackBar, this.hackProgress);
        this._setBarFill(this._drillBar, this.drillProgress);
    }

    _setBarFill(bar, t) {
        const fill = bar.getObjectByName('fill');
        fill.scale.x = Math.max(0.001, t);
        fill.position.x = -0.075 + (t * 0.15) / 2;
        bar.visible = t > 0.001 || this.stage !== STAGE.UNLOCKED;
    }

    // Bag drop zone (axis-aligned bounding box around the duffel)
    getLootBagBounds() {
        if (!this.room.bag) return null;
        const box = new THREE.Box3().setFromObject(this.room.bag);
        // Expand vertically so the player doesn't have to drop pixel-perfect
        box.expandByVector(new THREE.Vector3(0.1, 0.5, 0.1));
        return box;
    }
}

function makeProgressBar(color) {
    const group = new THREE.Group();
    const bgGeo = new THREE.PlaneGeometry(0.16, 0.025);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7 });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    group.add(bg);

    const fillGeo = new THREE.PlaneGeometry(0.15, 0.018);
    const fillMat = new THREE.MeshBasicMaterial({ color });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.name = 'fill';
    fill.position.z = 0.001;
    fill.scale.x = 0.001;
    group.add(fill);
    return group;
}
