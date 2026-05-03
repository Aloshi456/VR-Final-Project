// VR Heist Simulator - Main Entry Point
// ECE 376 Group 13 - Ryan, Alaa, George
//
// This file wires together:
//  - Three.js scene + WebXR setup
//  - Cannon-ES physics world (Lab 7)
//  - VR controller input + raycasting (Lab 8)
//  - Multi-tool inventory system
//  - Vault unlock state machine
//  - Loot collection win condition
//  - Desktop FPS-style fallback so the project is testable without a headset

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import CannonDebugger from 'cannon-es-debugger';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { buildVaultRoom } from './scene.js';
import { ToolSystem } from './tools.js';
import { VaultStateMachine } from './vault.js';
import { PhysicsSync } from './physics.js';
import { DesktopController } from './desktop.js';

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
let camera, scene, renderer;
let physicsWorld;
let raycaster;
let controller1, controller2;
let controllerGrip1, controllerGrip2;
let desktop;

let toolSystem;
let vault;
let physicsSync;

let cannonDebugger;
let debugGroup;
let isDebugVisible = false;

const grabbables = new THREE.Group();
const lootBag = [];
const clock = new THREE.Clock();

const hud = {
    tool: document.getElementById('tool-name'),
    stage: document.getElementById('stage-name'),
    lootCount: document.getElementById('loot-count'),
    lootTotal: document.getElementById('loot-total'),
    objective: document.getElementById('objective'),
};

init();

// Helper: works for both real XR controllers and the synthetic desktop one.
// XRControllers have `.matrixWorld`; we just point the raycaster down -Z from
// that matrix - same thing setFromXRController does internally.
export function setRaycasterFromController(rc, controller) {
    const tmpMatrix = new THREE.Matrix4();
    tmpMatrix.identity().extractRotation(controller.matrixWorld);
    rc.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    rc.ray.direction.set(0, 0, -1).applyMatrix4(tmpMatrix);
}

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0f);
    scene.fog = new THREE.Fog(0x0a0a0f, 6, 20);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 1.6, 3);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.xr.enabled = true;
    renderer.setAnimationLoop(animate);
    document.body.appendChild(renderer.domElement);
    document.body.appendChild(VRButton.createButton(renderer));

    physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    physicsWorld.broadphase = new CANNON.NaiveBroadphase();
    physicsWorld.solver.iterations = 10;
    physicsSync = new PhysicsSync(physicsWorld);

    const roomBuild = buildVaultRoom(scene, physicsWorld, physicsSync);
    vault = new VaultStateMachine(roomBuild, physicsSync, onVaultOpen);

    scene.add(grabbables);

    const loader = new GLTFLoader();
    toolSystem = new ToolSystem(scene, loader);

    raycaster = new THREE.Raycaster();
    setupControllers();

    // ---- Desktop fallback ----
    desktop = new DesktopController(camera, renderer, renderer.domElement, roomBuild.blockers);
    desktop.onTriggerStart = onSelectStart;
    desktop.onTriggerEnd = onSelectEnd;
    desktop.onSqueeze = () => toolSystem.cycleTool(desktop.fakeController, refreshHUD);

    debugGroup = new THREE.Group();
    debugGroup.visible = false;
    scene.add(debugGroup);
    cannonDebugger = CannonDebugger(debugGroup, physicsWorld);

    setupKeyboardControls();
    window.addEventListener('resize', onWindowResize);

    hud.lootTotal.textContent = roomBuild.lootItems.length;
    refreshHUD();

    for (const loot of roomBuild.lootItems) grabbables.add(loot.mesh);
}

function setupControllers() {
    controller1 = renderer.xr.getController(0);
    controller1.addEventListener('selectstart', onSelectStart);
    controller1.addEventListener('selectend', onSelectEnd);
    controller1.addEventListener('squeezestart', () => toolSystem.cycleTool(controller1, refreshHUD));
    scene.add(controller1);

    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('selectstart', onSelectStart);
    controller2.addEventListener('selectend', onSelectEnd);
    controller2.addEventListener('squeezestart', () => toolSystem.cycleTool(controller2, refreshHUD));
    scene.add(controller2);

    const factory = new XRControllerModelFactory();
    controllerGrip1 = renderer.xr.getControllerGrip(0);
    controllerGrip1.add(factory.createControllerModel(controllerGrip1));
    scene.add(controllerGrip1);

    controllerGrip2 = renderer.xr.getControllerGrip(1);
    controllerGrip2.add(factory.createControllerModel(controllerGrip2));
    scene.add(controllerGrip2);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1),
    ]);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x66d9ef }));
    line.scale.z = 5;
    controller1.add(line.clone());
    controller2.add(line.clone());
}

function onSelectStart(event) {
    const controller = event.target;
    setRaycasterFromController(raycaster, controller);

    const heldTool = toolSystem.getEquipped(controller);
    if (heldTool) {
        const used = vault.tryUseTool(heldTool, raycaster, controller);
        if (used) { refreshHUD(); return; }
    }

    const hits = raycaster.intersectObjects(grabbables.children, false);
    if (hits.length > 0) {
        const obj = hits[0].object;
        physicsSync.setKinematic(obj, true);
        controller.attach(obj);
        controller.userData.selected = obj;
        if (obj.material && obj.material.emissive) obj.material.emissive.setHex(0x444400);
    }
}

function onSelectEnd(event) {
    const controller = event.target;
    vault.endUse();

    const obj = controller.userData.selected;
    if (!obj) return;

    grabbables.attach(obj);
    if (obj.material && obj.material.emissive) obj.material.emissive.setHex(0x000000);
    controller.userData.selected = undefined;
    physicsSync.setKinematic(obj, false);

    const bagBounds = vault.getLootBagBounds();
    if (bagBounds && bagBounds.containsPoint(obj.position)) collectLoot(obj);
}

function collectLoot(mesh) {
    if (lootBag.includes(mesh)) return;
    lootBag.push(mesh);
    physicsSync.remove(mesh);
    grabbables.remove(mesh);
    refreshHUD();

    if (lootBag.length >= parseInt(hud.lootTotal.textContent, 10)) {
        hud.objective.textContent = 'HEIST COMPLETE - You got away clean.';
        hud.objective.style.color = '#7CFC00';
    }
}

function onVaultOpen() {
    hud.objective.textContent = 'Vault open! Grab the loot and drop it in the duffel bag.';
    hud.objective.style.color = '#ffcc55';
}

function refreshHUD() {
    const equipped =
        toolSystem.getEquipped(controller1) ||
        toolSystem.getEquipped(controller2) ||
        (desktop && toolSystem.getEquipped(desktop.fakeController));
    hud.tool.textContent = equipped ? equipped.displayName : 'EMPTY HAND';
    hud.stage.textContent = vault.getStageLabel();
    hud.lootCount.textContent = lootBag.length;
}

function setupKeyboardControls() {
    window.addEventListener('keydown', (e) => {
        switch (e.key.toLowerCase()) {
            case 't':
                toolSystem.cycleTool(desktop ? desktop.fakeController : controller1, refreshHUD);
                break;
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
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    physicsWorld.step(1 / 60, dt, 3);
    physicsSync.sync();
    if (desktop) desktop.update(dt);
    vault.update(dt, raycaster, controller1, controller2, toolSystem);

    if (isDebugVisible) cannonDebugger.update();
    renderer.render(scene, camera);
}
