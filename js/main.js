// VR Heist Simulator - Main Entry Point
// ECE 376 Group 13 - Ryan, Alaa, George
//
// Wires together:
//  - Three.js scene + WebXR
//  - Cannon-ES physics (Lab 7)
//  - VR controllers + raycasting (Lab 8)
//  - Tool pickups on the spawn table (grab them, bring to vault target)
//  - Random vault unlock sequence + proximity-based progress
//  - Loot collection win condition
//  - Desktop FPS-style fallback for testing without a headset
//  - WASD movement while inside the WebXR emulator
//  - Stable VR collision using xrRig position
//  - Vault door protruding collision fix
//  - Desktop + VR loot bin collision
//  - 3D VR win screen
//  - Hover highlighting for interactable objects
//  - Web Audio generated sound cues
//
// Shift sprint has been removed completely.
// Desktop mode and VR mode both use one consistent WASD movement speed.
//
// Loot fix:
// Loot now counts if its bounding box overlaps the bag/drop zone,
// instead of only checking the exact center point.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import CannonDebugger from 'cannon-es-debugger';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

import { buildVaultRoom } from './scene.js';
import { VaultStateMachine, generateRandomSequence } from './vault.js';
import { PhysicsSync } from './physics.js';
import { DesktopController } from './desktop.js';

let camera, scene, renderer;
let xrRig;
let physicsWorld;
let raycaster;
let controller1, controller2;
let controllerGrip1, controllerGrip2;
let desktop;

let vault;
let physicsSync;

let cannonDebugger;
let debugGroup;
let isDebugVisible = false;

let audioCtx = null;

let roomBlockers = [];
let desktopBlockers = [];
let vrWinScreen = null;

const grabbables = new THREE.Group();
const lootBag = [];
const clock = new THREE.Clock();

const vrMoveKeys = new Set();

let lastVaultProgress = 0;
let lastVaultStep = 0;
let lastProgressCueTime = 0;

const PROGRESS_CUE_INTERVAL = 0.15;

const VR_MOVE_SPEED = 2.2;
const VR_PLAYER_RADIUS = 0.28;

// Movement is split into small pieces so movement cannot tunnel through
// the room bounds, table, vault wall, or closed door.
const VR_COLLISION_STEP = 0.045;

// Stable inner room bounds.
// Visual room is x = -4 to 4 and z = -8 to 2.
const ROOM_MIN_X = -3.68;
const ROOM_MAX_X = 3.68;
const ROOM_MIN_Z = -7.68;
const ROOM_MAX_Z = 1.68;

// Tool table collision.
const TABLE_MIN_X = 2.12;
const TABLE_MAX_X = 3.08;
const TABLE_MIN_Z = -0.22;
const TABLE_MAX_Z = 0.22;

// Loot bin collision.
const BIN_MIN_X = 0.88;
const BIN_MAX_X = 1.72;
const BIN_MIN_Z = 0.45;
const BIN_MAX_Z = 1.15;

// Vault wall / doorway.
const VAULT_WALL_Z = -4.8;
const VAULT_WALL_HALF_THICKNESS = 0.24;
const DOORWAY_HALF_WIDTH = 1.05;

// Closed vault door collision.
const DOOR_COLLISION_MIN_X = -1.10;
const DOOR_COLLISION_MAX_X = 1.10;
const DOOR_COLLISION_BACK_Z = -4.85;
const DOOR_COLLISION_FRONT_Z = -4.30;

const RAY_LENGTH = 5.0;
const HOLD_DISTANCE = 0.65;
const HOVER_GLOW = 0x666600;
const SELECT_GLOW = 0x444400;
const RAY_COLOR_NORMAL = 0x66d9ef;
const RAY_COLOR_HOVER = 0xffcc55;

const hoveredObjects = new Set();

const _vrPlayerPos = new THREE.Vector3();
const _tmpLootBox = new THREE.Box3();
const _tmpLootCenter = new THREE.Vector3();
const _tmpBagCenter = new THREE.Vector3();

const hud = {
    tool: document.getElementById('tool-name'),
    stage: document.getElementById('stage-name'),
    lootCount: document.getElementById('loot-count'),
    lootTotal: document.getElementById('loot-total'),
    objective: document.getElementById('objective'),
    winScreen: document.getElementById('win-screen'),
};

init();

export function setRaycasterFromController(rc, controller) {
    const tmpMatrix = new THREE.Matrix4();

    tmpMatrix.identity().extractRotation(controller.matrixWorld);

    rc.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    rc.ray.direction.set(0, 0, -1).applyMatrix4(tmpMatrix);
}

function playCue(type = 'grab') {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();

        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const now = audioCtx.currentTime;

        const tone = (
            freq,
            startOffset,
            duration,
            volume = 0.08,
            wave = 'sine'
        ) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc.type = wave;
            osc.frequency.setValueAtTime(freq, now + startOffset);

            gain.gain.setValueAtTime(0.0001, now + startOffset);
            gain.gain.exponentialRampToValueAtTime(volume, now + startOffset + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start(now + startOffset);
            osc.stop(now + startOffset + duration + 0.02);
        };

        switch (type) {
            case 'progress':
                // Clear ticking/beeping while holding correct tool on target.
                tone(720, 0.00, 0.055, 0.045, 'square');
                tone(920, 0.045, 0.050, 0.030, 'triangle');
                break;

            case 'grab':
                // Quick pickup click.
                tone(440, 0.00, 0.045, 0.06, 'triangle');
                break;

            case 'stage':
                // Bright success chime when one lock/keypad/bolt step completes.
                tone(523, 0.00, 0.08, 0.085, 'triangle');
                tone(659, 0.08, 0.09, 0.080, 'triangle');
                tone(880, 0.17, 0.13, 0.075, 'triangle');
                break;

            case 'open':
                // Vault opens: mechanical thunk + positive success rise.
                tone(190, 0.00, 0.16, 0.095, 'sawtooth');
                tone(330, 0.12, 0.08, 0.060, 'triangle');
                tone(523, 0.22, 0.10, 0.080, 'triangle');
                tone(659, 0.32, 0.12, 0.075, 'triangle');
                tone(880, 0.45, 0.16, 0.065, 'triangle');
                break;

            case 'loot':
                // Coin-like collection sound.
                tone(960, 0.00, 0.055, 0.07, 'triangle');
                tone(1320, 0.055, 0.07, 0.055, 'triangle');
                break;

            case 'win':
                // Victory sound.
                tone(523, 0.00, 0.12, 0.08, 'triangle');
                tone(659, 0.12, 0.12, 0.08, 'triangle');
                tone(784, 0.24, 0.18, 0.09, 'triangle');
                tone(1046, 0.42, 0.25, 0.07, 'triangle');
                break;

            default:
                tone(440, 0.00, 0.05, 0.06, 'sine');
                break;
        }
    } catch (err) {
        console.warn('[heist] audio cue skipped:', err);
    }
}

function pulseController(controller, intensity = 0.4, duration = 80) {
    const source = controller?.userData?.inputSource;
    const actuator = source?.gamepad?.hapticActuators?.[0];

    if (actuator?.pulse) {
        actuator.pulse(intensity, duration).catch(() => {});
    }
}

function pulseAll(intensity = 0.4, duration = 80) {
    pulseController(controller1, intensity, duration);
    pulseController(controller2, intensity, duration);
}

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0f);
    scene.fog = new THREE.Fog(0x0a0a0f, 6, 20);

    camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        100
    );

    camera.position.set(0, 1.6, 1);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.setAnimationLoop(animate);
    document.body.appendChild(renderer.domElement);

    const vrBtn = VRButton.createButton(renderer);
    document.body.appendChild(vrBtn);

    xrRig = new THREE.Group();
    xrRig.position.set(0, 0, 0);
    scene.add(xrRig);

    xrRig.add(camera);

    renderer.xr.addEventListener('sessionstart', () => {
        console.log('[heist] XR session started');

        xrRig.position.set(0, 0, 1);
        vrMoveKeys.clear();

        if (desktop?.fakeController) {
            desktop.fakeController.visible = false;
        }
    });

    renderer.xr.addEventListener('sessionend', () => {
        console.log('[heist] XR session ended');

        xrRig.position.set(0, 0, 0);
        vrMoveKeys.clear();

        if (desktop?.fakeController) {
            desktop.fakeController.visible = true;
        }
    });

    window.addEventListener('unhandledrejection', (e) => {
        if (String(e.reason).toLowerCase().includes('xr')) {
            console.error('[heist] XR session rejection:', e.reason);
        }
    });

    physicsWorld = new CANNON.World({
        gravity: new CANNON.Vec3(0, -9.82, 0),
    });

    physicsWorld.broadphase = new CANNON.NaiveBroadphase();
    physicsWorld.solver.iterations = 10;

    physicsSync = new PhysicsSync(physicsWorld);

    const sequence = generateRandomSequence();

    console.log(
        '[heist] sequence:',
        sequence.map(s => `${s.toolLabel}->${s.targetLabel}`).join(', ')
    );

    const roomBuild = buildVaultRoom(scene, physicsWorld, physicsSync, sequence);

    roomBlockers = roomBuild.blockers || [];

    vault = new VaultStateMachine(
        roomBuild,
        physicsSync,
        sequence,
        onVaultOpen
    );

    lastVaultProgress = vault.progress || 0;
    lastVaultStep = vault.currentStep || 0;
    lastProgressCueTime = clock.getElapsedTime();

    scene.add(grabbables);

    for (const t of roomBuild.tableTools) {
        grabbables.add(t.mesh);
    }

    for (const loot of roomBuild.lootItems) {
        grabbables.add(loot.mesh);
    }

    raycaster = new THREE.Raycaster();

    setupControllers();

    desktopBlockers = makeDesktopBlockers(roomBuild);

    desktop = new DesktopController(
        camera,
        renderer,
        renderer.domElement,
        desktopBlockers
    );

    scene.add(desktop.fakeController);

    desktop.onTriggerStart = onSelectStart;
    desktop.onTriggerEnd = onSelectEnd;
    desktop.onSqueeze = () => {};

    vrWinScreen = createVRWinScreen();
    scene.add(vrWinScreen);

    debugGroup = new THREE.Group();
    debugGroup.visible = false;
    scene.add(debugGroup);

    cannonDebugger = CannonDebugger(debugGroup, physicsWorld);

    setupKeyboardControls();

    window.addEventListener('resize', onWindowResize);

    hud.lootTotal.textContent = roomBuild.lootItems.length;

    refreshHUD();
}

function makeInvisibleDesktopBlocker(name, center, size) {
    const material = new THREE.MeshBasicMaterial({
        color: 0xff00ff,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        depthTest: false,
    });

    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        material
    );

    mesh.name = name;
    mesh.position.copy(center);
    mesh.visible = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.desktopOnlyBlocker = true;

    scene.add(mesh);

    return mesh;
}

function makeDesktopBlockers(roomBuild) {
    const blockers = [...(roomBuild.blockers || [])];

    const tableCenter = new THREE.Vector3(
        (TABLE_MIN_X + TABLE_MAX_X) / 2,
        0.65,
        (TABLE_MIN_Z + TABLE_MAX_Z) / 2
    );

    const tableSize = new THREE.Vector3(
        (TABLE_MAX_X - TABLE_MIN_X) + 0.45,
        1.30,
        (TABLE_MAX_Z - TABLE_MIN_Z) + 0.55
    );

    blockers.push(
        makeInvisibleDesktopBlocker(
            'desktop-table-blocker',
            tableCenter,
            tableSize
        )
    );

    if (roomBuild.bag) {
        roomBuild.bag.updateMatrixWorld(true);

        const bagBox = new THREE.Box3().setFromObject(roomBuild.bag);

        if (!bagBox.isEmpty()) {
            const bagCenter = new THREE.Vector3();
            const bagSize = new THREE.Vector3();

            bagBox.getCenter(bagCenter);
            bagBox.getSize(bagSize);

            bagSize.x = Math.max(bagSize.x + 0.35, 0.75);
            bagSize.y = Math.max(bagSize.y + 0.60, 0.95);
            bagSize.z = Math.max(bagSize.z + 0.35, 0.75);

            bagCenter.y = bagSize.y / 2;

            blockers.push(
                makeInvisibleDesktopBlocker(
                    'desktop-loot-bin-blocker',
                    bagCenter,
                    bagSize
                )
            );
        }
    }

    console.log('[heist] desktop blockers:', blockers.length);

    return blockers;
}

function createVRWinScreen() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;

    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#ffcc55';
    ctx.lineWidth = 14;
    ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);

    ctx.fillStyle = '#ffcc55';
    ctx.font = 'bold 86px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HEIST COMPLETE', canvas.width / 2, 180);

    ctx.fillStyle = '#ffffff';
    ctx.font = '42px Arial, sans-serif';
    ctx.fillText('You cracked the vault', canvas.width / 2, 270);
    ctx.fillText('and collected the loot.', canvas.width / 2, 330);

    ctx.fillStyle = '#cccccc';
    ctx.font = '30px Arial, sans-serif';
    ctx.fillText('Press R to reset and replay.', canvas.width / 2, 420);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: true,
    });

    const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 1.2),
        material
    );

    panel.name = 'vr-win-screen';
    panel.visible = false;
    panel.position.set(0, 2.0, -2.5);

    return panel;
}

function showVRWinScreen() {
    if (!vrWinScreen) return;

    vrWinScreen.visible = true;

    if (renderer.xr.isPresenting) {
        const xrCamera = renderer.xr.getCamera(camera);
        const camPos = new THREE.Vector3();
        const camDir = new THREE.Vector3();

        xrCamera.updateMatrixWorld(true);
        xrCamera.getWorldPosition(camPos);
        xrCamera.getWorldDirection(camDir);

        vrWinScreen.position.copy(camPos).add(camDir.multiplyScalar(2.2));
        vrWinScreen.position.y = camPos.y;

        vrWinScreen.lookAt(camPos);
    } else {
        vrWinScreen.position.set(0, 2.0, -2.5);
        vrWinScreen.lookAt(camera.position);
    }
}

function setupControllers() {
    controller1 = renderer.xr.getController(0);

    controller1.addEventListener('connected', (event) => {
        controller1.userData.inputSource = event.data;
    });

    controller1.addEventListener('selectstart', onSelectStart);
    controller1.addEventListener('selectend', onSelectEnd);

    xrRig.add(controller1);

    controller2 = renderer.xr.getController(1);

    controller2.addEventListener('connected', (event) => {
        controller2.userData.inputSource = event.data;
    });

    controller2.addEventListener('selectstart', onSelectStart);
    controller2.addEventListener('selectend', onSelectEnd);

    xrRig.add(controller2);

    const factory = new XRControllerModelFactory();

    controllerGrip1 = renderer.xr.getControllerGrip(0);
    controllerGrip1.add(factory.createControllerModel(controllerGrip1));
    xrRig.add(controllerGrip1);

    controllerGrip2 = renderer.xr.getControllerGrip(1);
    controllerGrip2.add(factory.createControllerModel(controllerGrip2));
    xrRig.add(controllerGrip2);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1),
    ]);

    const line1 = new THREE.Line(
        lineGeo.clone(),
        new THREE.LineBasicMaterial({ color: RAY_COLOR_NORMAL })
    );

    line1.name = 'line';
    line1.scale.z = RAY_LENGTH;

    const line2 = new THREE.Line(
        lineGeo.clone(),
        new THREE.LineBasicMaterial({ color: RAY_COLOR_NORMAL })
    );

    line2.name = 'line';
    line2.scale.z = RAY_LENGTH;

    controller1.add(line1);
    controller2.add(line2);
}

function getTopLevelGrabbable(object) {
    let obj = object;

    while (obj && !grabbables.children.includes(obj)) {
        obj = obj.parent;
    }

    return obj || null;
}

function ensureUniqueMaterials(object) {
    object.traverse((child) => {
        if (!child.isMesh || !child.material || child.userData.heistMaterialCloned) return;

        if (Array.isArray(child.material)) {
            child.material = child.material.map((mat) => mat.clone());
        } else {
            child.material = child.material.clone();
        }

        child.userData.heistMaterialCloned = true;
    });
}

function forEachMaterial(object, callback) {
    object.traverse((child) => {
        if (!child.isMesh || !child.material) return;

        const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];

        for (const mat of materials) {
            if (mat) callback(mat);
        }
    });
}

function setObjectGlow(object, colorHex) {
    if (!object) return;

    ensureUniqueMaterials(object);

    forEachMaterial(object, (mat) => {
        if (!mat.emissive) return;

        if (mat.userData.heistOriginalEmissive === undefined) {
            mat.userData.heistOriginalEmissive = mat.emissive.getHex();
        }

        mat.emissive.setHex(colorHex);
    });
}

function restoreObjectGlow(object) {
    if (!object) return;

    forEachMaterial(object, (mat) => {
        if (!mat.emissive) return;

        if (mat.userData.heistOriginalEmissive !== undefined) {
            mat.emissive.setHex(mat.userData.heistOriginalEmissive);
        } else {
            mat.emissive.setHex(0x000000);
        }
    });
}

function isObjectSelected(object) {
    return (
        controller1?.userData.selected === object ||
        controller2?.userData.selected === object ||
        desktop?.fakeController?.userData.selected === object
    );
}

function getControllerLine(controller) {
    if (!controller) return null;
    return controller.getObjectByName('line');
}

function setControllerLineState(controller, distance = RAY_LENGTH, isHovering = false) {
    const line = getControllerLine(controller);

    if (!line) return;

    line.scale.z = Math.max(0.05, Math.min(distance, RAY_LENGTH));

    if (line.material && line.material.color) {
        line.material.color.setHex(isHovering ? RAY_COLOR_HOVER : RAY_COLOR_NORMAL);
    }
}

function clearHoverHighlights() {
    for (const obj of hoveredObjects) {
        if (!isObjectSelected(obj)) {
            restoreObjectGlow(obj);
        }
    }

    hoveredObjects.clear();
}

function updateHoverForController(controller) {
    if (!controller) return;

    if (controller.userData.selected) {
        setControllerLineState(controller, HOLD_DISTANCE, false);
        setObjectGlow(controller.userData.selected, SELECT_GLOW);
        return;
    }

    setRaycasterFromController(raycaster, controller);

    const hits = raycaster.intersectObjects(grabbables.children, true);

    if (hits.length === 0) {
        setControllerLineState(controller, RAY_LENGTH, false);
        return;
    }

    const hit = hits[0];
    const obj = getTopLevelGrabbable(hit.object);

    if (!obj) {
        setControllerLineState(controller, RAY_LENGTH, false);
        return;
    }

    setObjectGlow(obj, HOVER_GLOW);
    hoveredObjects.add(obj);

    setControllerLineState(controller, hit.distance, true);
}

function updateHoverHighlights() {
    clearHoverHighlights();

    updateHoverForController(controller1);
    updateHoverForController(controller2);

    if (!renderer.xr.isPresenting && desktop?.fakeController) {
        updateHoverForController(desktop.fakeController);
    }
}

function onSelectStart(event) {
    const controller = event.target;

    setRaycasterFromController(raycaster, controller);

    if (controller.userData.selected) return;

    const hits = raycaster.intersectObjects(grabbables.children, true);

    if (hits.length === 0) return;

    const obj = getTopLevelGrabbable(hits[0].object);

    if (!obj) return;

    physicsSync.setKinematic(obj, true);

    controller.attach(obj);

    obj.position.set(0, 0, -HOLD_DISTANCE);

    controller.userData.selected = obj;

    setControllerLineState(controller, HOLD_DISTANCE, false);
    setObjectGlow(obj, SELECT_GLOW);

    playCue('grab');
    pulseController(controller, 0.25, 60);
}

function isLootInBag(mesh) {
    if (!mesh || !mesh.userData?.lootValue) return false;

    const bagBounds = vault?.getLootBagBounds();

    if (!bagBounds) return false;

    mesh.updateMatrixWorld(true);

    _tmpLootBox.setFromObject(mesh);
    _tmpLootBox.expandByScalar(0.08);
    _tmpLootBox.getCenter(_tmpLootCenter);

    if (bagBounds.intersectsBox(_tmpLootBox)) {
        return true;
    }

    bagBounds.getCenter(_tmpBagCenter);

    const dx = _tmpLootCenter.x - _tmpBagCenter.x;
    const dz = _tmpLootCenter.z - _tmpBagCenter.z;
    const horizontalDistance = Math.sqrt(dx * dx + dz * dz);

    const closeEnoughXZ = horizontalDistance < 0.75;
    const reasonableHeight =
        _tmpLootCenter.y > bagBounds.min.y - 0.25 &&
        _tmpLootCenter.y < bagBounds.max.y + 0.55;

    return closeEnoughXZ && reasonableHeight;
}

function onSelectEnd(event) {
    const controller = event.target;
    const obj = controller.userData.selected;

    if (!obj) return;

    grabbables.attach(obj);

    restoreObjectGlow(obj);

    controller.userData.selected = undefined;

    setControllerLineState(controller, RAY_LENGTH, false);

    if (isLootInBag(obj)) {
        collectLoot(obj);
        return;
    }

    physicsSync.setKinematic(obj, false);
}

function collectLoot(mesh) {
    if (lootBag.includes(mesh)) return;

    lootBag.push(mesh);

    physicsSync.remove(mesh);
    grabbables.remove(mesh);

    restoreObjectGlow(mesh);

    playCue('loot');
    pulseAll(0.35, 90);

    refreshHUD();

    if (lootBag.length >= parseInt(hud.lootTotal.textContent, 10)) {
        hud.objective.textContent = 'HEIST COMPLETE - You got away clean.';
        hud.objective.style.color = '#7CFC00';

        if (hud.winScreen) {
            hud.winScreen.classList.remove('hidden');
        }

        showVRWinScreen();

        playCue('win');
        pulseAll(0.75, 250);
    }
}

function onVaultOpen() {
    hud.objective.textContent = 'Vault open! Grab the gold coins, drop them in the bag.';
    hud.objective.style.color = '#ffcc55';

    playCue('open');
    pulseAll(0.6, 180);
}

function refreshHUD() {
    const heldByDesktop = !renderer.xr.isPresenting
        ? desktop?.fakeController.userData.selected
        : null;

    const heldByC1 = controller1?.userData.selected;
    const heldByC2 = controller2?.userData.selected;

    const held = heldByDesktop || heldByC1 || heldByC2;

    if (held && held.userData.toolName) {
        hud.tool.textContent = held.userData.toolName;
    } else {
        hud.tool.textContent = 'EMPTY HAND';
    }

    hud.stage.textContent = vault.getStageLabel();
    hud.lootCount.textContent = lootBag.length;
}

function setupKeyboardControls() {
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();

        if (['w', 'a', 's', 'd'].includes(key)) {
            vrMoveKeys.add(key);
        }

        switch (key) {
            case 'u':
                vault.forceAdvance();
                refreshHUD();
                break;

            case 'r':
                window.location.reload();
                break;

            case 'b':
                isDebugVisible = !isDebugVisible;
                debugGroup.visible = isDebugVisible;
                break;
        }
    });

    window.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();

        vrMoveKeys.delete(key);
    });
}

function getVRPlayerWorldPosition() {
    _vrPlayerPos.set(
        xrRig.position.x,
        1.6,
        xrRig.position.z
    );

    return _vrPlayerPos;
}

function clampVRRigToRoom() {
    xrRig.position.x = THREE.MathUtils.clamp(
        xrRig.position.x,
        ROOM_MIN_X,
        ROOM_MAX_X
    );

    xrRig.position.z = THREE.MathUtils.clamp(
        xrRig.position.z,
        ROOM_MIN_Z,
        ROOM_MAX_Z
    );
}

function circleIntersectsAABB(x, z, radius, minX, maxX, minZ, maxZ) {
    const closestX = THREE.MathUtils.clamp(x, minX, maxX);
    const closestZ = THREE.MathUtils.clamp(z, minZ, maxZ);

    const dx = x - closestX;
    const dz = z - closestZ;

    return (dx * dx + dz * dz) < radius * radius;
}

function vrCollidesAt(x, z) {
    const radius = VR_PLAYER_RADIUS;

    if (x < ROOM_MIN_X) return true;
    if (x > ROOM_MAX_X) return true;
    if (z < ROOM_MIN_Z) return true;
    if (z > ROOM_MAX_Z) return true;

    if (
        circleIntersectsAABB(
            x,
            z,
            radius,
            TABLE_MIN_X,
            TABLE_MAX_X,
            TABLE_MIN_Z,
            TABLE_MAX_Z
        )
    ) {
        return true;
    }

    if (
        circleIntersectsAABB(
            x,
            z,
            radius,
            BIN_MIN_X,
            BIN_MAX_X,
            BIN_MIN_Z,
            BIN_MAX_Z
        )
    ) {
        return true;
    }

    const doorIsOpen = vault?.room?.door?.userData?.isOpen;

    if (!doorIsOpen) {
        if (
            circleIntersectsAABB(
                x,
                z,
                radius,
                DOOR_COLLISION_MIN_X,
                DOOR_COLLISION_MAX_X,
                DOOR_COLLISION_BACK_Z,
                DOOR_COLLISION_FRONT_Z
            )
        ) {
            return true;
        }
    }

    const insideVaultWallBand = Math.abs(z - VAULT_WALL_Z) < VAULT_WALL_HALF_THICKNESS;

    if (insideVaultWallBand) {
        const inDoorwayOpening = Math.abs(x) < DOORWAY_HALF_WIDTH - radius;

        if (!inDoorwayOpening) {
            return true;
        }

        if (!doorIsOpen) {
            return true;
        }
    }

    return false;
}

function applySingleVRMoveStep(stepMove) {
    const playerPos = getVRPlayerWorldPosition();

    const fullX = playerPos.x + stepMove.x;
    const fullZ = playerPos.z + stepMove.z;

    if (!vrCollidesAt(fullX, fullZ)) {
        xrRig.position.add(stepMove);
        clampVRRigToRoom();
        return;
    }

    if (!vrCollidesAt(playerPos.x + stepMove.x, playerPos.z)) {
        xrRig.position.x += stepMove.x;
        clampVRRigToRoom();
        return;
    }

    if (!vrCollidesAt(playerPos.x, playerPos.z + stepMove.z)) {
        xrRig.position.z += stepMove.z;
        clampVRRigToRoom();
    }
}

function applyVRMoveWithCollision(move) {
    clampVRRigToRoom();

    const distance = move.length();

    if (distance <= 0) return;

    const steps = Math.max(1, Math.ceil(distance / VR_COLLISION_STEP));
    const stepMove = move.clone().multiplyScalar(1 / steps);

    for (let i = 0; i < steps; i++) {
        applySingleVRMoveStep(stepMove);
    }
}

function updateVRLocomotion(dt) {
    if (!renderer.xr.isPresenting || !xrRig) return;

    clampVRRigToRoom();

    const speed = VR_MOVE_SPEED * dt;

    const xrCamera = renderer.xr.getCamera(camera);
    const forward = new THREE.Vector3();

    xrCamera.getWorldDirection(forward);
    forward.y = 0;

    if (forward.lengthSq() === 0) return;

    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const move = new THREE.Vector3();

    if (vrMoveKeys.has('w')) move.add(forward);
    if (vrMoveKeys.has('s')) move.sub(forward);
    if (vrMoveKeys.has('d')) move.add(right);
    if (vrMoveKeys.has('a')) move.sub(right);

    if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed);
        applyVRMoveWithCollision(move);
    }
}

function updateVaultAudioCues() {
    if (!vault) return;

    const currentProgress = vault.progress || 0;
    const currentStep = vault.currentStep || 0;
    const now = clock.getElapsedTime();

    if (currentStep > lastVaultStep) {
        playCue('stage');

        lastVaultStep = currentStep;
        lastVaultProgress = currentProgress;
        lastProgressCueTime = now;

        return;
    }

    const progressIncreasing = currentProgress > lastVaultProgress + 0.001;
    const enoughTimePassed = now - lastProgressCueTime >= PROGRESS_CUE_INTERVAL;

    if (
        progressIncreasing &&
        currentProgress > 0.02 &&
        currentProgress < 0.99 &&
        enoughTimePassed
    ) {
        playCue('progress');
        lastProgressCueTime = now;
    }

    lastVaultProgress = currentProgress;
    lastVaultStep = currentStep;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    const t = clock.getElapsedTime();

    physicsWorld.step(1 / 60, dt, 3);

    physicsSync.sync();

    if (desktop) {
        const desktopActive = !renderer.xr.isPresenting;

        desktop.fakeController.visible = desktopActive;

        if (desktopActive) {
            desktop.update(dt);
        }
    }

    updateVRLocomotion(dt);

    if (scene._dynamicLights) {
        for (const light of scene._dynamicLights) {
            if (light.userData?.tick) {
                light.userData.tick(t);
            }
        }
    }

    updateHoverHighlights();

    const activeControllers = [
        controller1,
        controller2,
    ];

    if (!renderer.xr.isPresenting && desktop) {
        activeControllers.push(desktop.fakeController);
    }

    vault.update(dt, activeControllers);

    updateVaultAudioCues();

    refreshHUD();

    if (isDebugVisible) {
        cannonDebugger.update();
    }

    renderer.render(scene, camera);
}