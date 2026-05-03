// Tool meshes.
// Tools are physical pickups on the table - the player walks up, grabs one,
// and brings it to the matching vault target. The "equipped tool" is just
// whichever toolId is on the held mesh in the player's hand.
//
// This module exports buildToolMesh(id) so scene.js can spawn the procedural
// tool meshes on the table. The legacy ToolSystem class (grip-button cycle)
// is kept for backward-compat but is no longer the primary interaction.

import * as THREE from 'three';

const TOOL_ORDER = [null, 'lockpick', 'hacker', 'drill'];

const TOOL_DEFS = {
    lockpick: {
        id: 'lockpick',
        displayName: 'LOCKPICK',
        modelPath: 'models/lockpick.glb',
        color: 0xc0c0c0,
        build: buildLockpickProcedural,
    },
    hacker: {
        id: 'hacker',
        displayName: 'HACKING DEVICE',
        modelPath: 'models/hacker.glb',
        color: 0x33ff66,
        build: buildHackerProcedural,
    },
    drill: {
        id: 'drill',
        displayName: 'DRILL',
        modelPath: 'models/drill.glb',
        color: 0xffaa22,
        build: buildDrillProcedural,
    },
};

export class ToolSystem {
    constructor(scene, loader) {
        this.scene = scene;
        this.loader = loader;
        this.equipped = new Map();  // controller -> tool def
        this.toolMeshes = new Map(); // toolId -> { template Object3D }

        // Pre-build procedural fallbacks; try to upgrade to GLB when available
        for (const id of Object.keys(TOOL_DEFS)) {
            const def = TOOL_DEFS[id];
            this.toolMeshes.set(id, def.build(def.color));
            loadModelOrFallback(this.loader, def.modelPath, (gltf) => {
                this.toolMeshes.set(id, gltf.scene);
            });
        }
    }

    getEquipped(controller) {
        if (!controller) return null;
        return this.equipped.get(controller) || null;
    }

    cycleTool(controller, onChange) {
        if (!controller) return;
        const current = this.equipped.get(controller);
        const idx = TOOL_ORDER.indexOf(current ? current.id : null);
        const nextId = TOOL_ORDER[(idx + 1) % TOOL_ORDER.length];

        // Detach old tool mesh from controller
        const old = controller.userData.toolMesh;
        if (old) {
            controller.remove(old);
            controller.userData.toolMesh = null;
        }

        if (nextId == null) {
            this.equipped.set(controller, null);
        } else {
            const def = TOOL_DEFS[nextId];
            this.equipped.set(controller, def);
            // Clone the template so each controller has its own mesh instance
            const mesh = this.toolMeshes.get(nextId).clone(true);
            mesh.position.set(0, -0.05, -0.12);
            mesh.rotation.set(-Math.PI / 2.5, 0, 0);
            controller.add(mesh);
            controller.userData.toolMesh = mesh;
        }
        if (onChange) onChange();
    }
}

// ---------------------------------------------------------------------------
// Public factory: build a procedural tool mesh by id. scene.js uses this to
// place tools on the table.
// ---------------------------------------------------------------------------
export function buildToolMesh(id) {
    const def = TOOL_DEFS[id];
    if (!def) throw new Error(`Unknown tool id: ${id}`);
    const mesh = def.build(def.color);
    mesh.userData.toolId = id;
    mesh.userData.toolName = def.displayName;
    return mesh;
}

// ---------------------------------------------------------------------------
// Procedural tool meshes (fallback when no .glb is found)
// ---------------------------------------------------------------------------
function buildLockpickProcedural(color) {
    const group = new THREE.Group();
    const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.07, 0.025),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 })
    );
    handle.position.y = -0.04;
    group.add(handle);

    const pin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0025, 0.0025, 0.1, 8),
        new THREE.MeshStandardMaterial({ color, roughness: 0.2, metalness: 0.95 })
    );
    pin.position.y = 0.05;
    group.add(pin);

    // Bent tip
    const tip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0025, 0.0025, 0.02, 8),
        new THREE.MeshStandardMaterial({ color, roughness: 0.2, metalness: 0.95 })
    );
    tip.position.set(0.008, 0.105, 0);
    tip.rotation.z = -Math.PI / 4;
    group.add(tip);
    return group;
}

function buildHackerProcedural(color) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.16, 0.025),
        new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 })
    );
    group.add(body);

    const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.07, 0.05),
        new THREE.MeshBasicMaterial({ color })
    );
    screen.position.set(0, 0.03, 0.013);
    group.add(screen);

    // Probe wire
    const probe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.002, 0.002, 0.08, 8),
        new THREE.MeshStandardMaterial({ color: 0xff3333 })
    );
    probe.position.set(0, 0.12, 0);
    group.add(probe);
    return group;
}

function buildDrillProcedural(color) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.06, 0.18),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 })
    );
    body.position.set(0, 0.03, 0);
    group.add(body);

    const grip = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.12, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 })
    );
    grip.position.set(0, -0.05, 0.02);
    group.add(grip);

    const bit = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.12, 12),
        new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 1 })
    );
    bit.rotation.x = Math.PI / 2;
    bit.position.set(0, 0.03, 0.15);
    group.add(bit);
    return group;
}

// Try loading a GLB; fall back to procedural if it 404s.
function loadModelOrFallback(loader, path, onSuccess) {
    if (!loader) return;
    loader.load(path, (gltf) => {
        console.log(`[heist] ${path} loaded successfully`);
        gltf.scene.traverse(c => { if (c.isMesh) c.castShadow = true; });
        onSuccess(gltf);
    }, undefined, (err) => {
        console.warn(`[heist] ${path} not found - using procedural fallback`, err);
    });
}
