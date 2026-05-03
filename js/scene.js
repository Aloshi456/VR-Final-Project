// Vault room construction.
//
// Builds:
//   - Floor + 4 walls + ceiling (mesh + static physics)
//   - Vault door with hinge constraint (so it swings on Cannon-ES physics)
//   - Keypad, drill bolt, and lockpick lock surface (interaction targets)
//   - Loot items (gold bars, gem) inside the vault
//   - Duffel bag drop zone next to the player
//   - Lighting
//
// NOTE for the team: replace the procedural vault door, tools, and loot meshes
// with custom .glb files exported from Blender by dropping them in /models and
// loading them with GLTFLoader (see commented stub in createVaultDoor).

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---- Materials ----
const concreteMat = new THREE.MeshStandardMaterial({ color: 0x383841, roughness: 0.95, metalness: 0.05 });
const steelMat = new THREE.MeshStandardMaterial({ color: 0x6b6b75, roughness: 0.4, metalness: 0.85 });
const goldMat = new THREE.MeshStandardMaterial({ color: 0xffcc33, roughness: 0.25, metalness: 1.0, emissive: 0x000000 });
const gemMat = new THREE.MeshStandardMaterial({ color: 0x33ddff, roughness: 0.05, metalness: 0.2, emissive: 0x113344 });

export function buildVaultRoom(scene, world, sync) {
    // ---- Lights ----
    scene.add(new THREE.HemisphereLight(0xb0b0b0, 0x111111, 0.55));

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(4, 6, 3);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    scene.add(keyLight);

    // Warm spotlight on the vault door for cinematic feel
    const spot = new THREE.SpotLight(0xffaa55, 8, 8, Math.PI / 6, 0.4, 1.2);
    spot.position.set(0, 3.5, -1);
    spot.target.position.set(0, 1.3, -4.5);
    scene.add(spot);
    scene.add(spot.target);

    // ---- Room dimensions ----
    const W = 8, D = 10, H = 3.5;

    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D), concreteMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    floorMesh.position.z = -D / 2 + 2;
    scene.add(floorMesh);

    const floorBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(floorBody);

    // Ceiling
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), concreteMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, H, -D / 2 + 2);
    scene.add(ceil);

    // Track every collider the player should not be able to pass through.
    const blockers = [];

    // Outer walls (back, left, right)
    blockers.push(addWall(scene, world, { w: W, h: H, x: 0, y: H / 2, z: -D + 2, rotY: 0 }));
    blockers.push(addWall(scene, world, { w: D, h: H, x: -W / 2, y: H / 2, z: -D / 2 + 2, rotY: Math.PI / 2 }));
    blockers.push(addWall(scene, world, { w: D, h: H, x: W / 2, y: H / 2, z: -D / 2 + 2, rotY: -Math.PI / 2 }));
    // Front wall with doorway opening cut: two slim walls flanking the entry
    blockers.push(addWall(scene, world, { w: 2.5, h: H, x: -2.75, y: H / 2, z: 2, rotY: Math.PI }));
    blockers.push(addWall(scene, world, { w: 2.5, h: H, x: 2.75, y: H / 2, z: 2, rotY: Math.PI }));

    // ---- Vault wall (separates antechamber from vault interior) ----
    // The door is the only opening - solid collision everywhere else so the
    // player can't sneak around the door.
    // Placed at z=-4.8 so its physics body doesn't overlap with the door body
    // at z=-4.5 (door extends to z=-4.65).
    const vaultWallPanels = addVaultWall(scene, world, {
        wallW: W, wallH: H, openingW: 2.1, openingH: 2.7, z: -4.8
    });
    blockers.push(...vaultWallPanels);

    // ---- Vault door (with hinge) ----
    const vault = createVaultDoor(scene, world, sync);
    // Door blocks the player when closed; once it swings open, its bbox moves
    // out of the doorway and the player can walk through.
    blockers.push(vault.door);

    // ---- Interaction targets in front of door ----
    // Keypad on the right side of the door
    const keypadMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.45, 0.04),
        new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x000000, roughness: 0.6 })
    );
    keypadMesh.position.set(1.35, 1.45, -4.42);
    keypadMesh.castShadow = true;
    keypadMesh.userData.interaction = 'keypad';
    scene.add(keypadMesh);
    addKeypadButtons(keypadMesh);

    // Lockpick keyhole on the left side
    const lockMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.05, 24),
        new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.9 })
    );
    lockMesh.rotation.x = Math.PI / 2;
    lockMesh.position.set(-1.35, 1.45, -4.42);
    lockMesh.castShadow = true;
    lockMesh.userData.interaction = 'lock';
    scene.add(lockMesh);

    // Drill bolt - the final stage target on the door itself
    const boltMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.08, 12),
        new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.5, metalness: 0.9 })
    );
    boltMesh.rotation.x = Math.PI / 2;
    boltMesh.position.set(0, 1.6, -4.42);
    boltMesh.castShadow = true;
    boltMesh.userData.interaction = 'bolt';
    scene.add(boltMesh);

    // ---- Loot items (inside vault, get revealed when door opens) ----
    const lootItems = createLoot(scene, world, sync);

    // ---- Duffel bag drop zone (in front of player) ----
    const bag = createDuffelBag(scene);

    // ---- Tool table to the player's right ----
    createToolTable(scene);

    return {
        door: vault.door,
        doorBody: vault.doorBody,
        hinge: vault.hinge,
        keypad: keypadMesh,
        lock: lockMesh,
        bolt: boltMesh,
        lootItems,
        bag,
        blockers,
    };
}

// Vault dividing wall with a doorway opening. Built from 3 solid panels:
// left of door, right of door, and lintel above door. Each panel has matching
// physics collision so the player cannot walk through the wall.
function addVaultWall(scene, world, { wallW, wallH, openingW, openingH, z }) {
    const sideW = (wallW - openingW) / 2;
    const lintelH = wallH - openingH;

    const wallMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a30,
        roughness: 0.85,
        metalness: 0.15,
    });

    const panels = [];
    // ---- Left panel ----
    panels.push(addWallPanel(scene, world, wallMat, {
        w: sideW, h: wallH,
        x: -openingW / 2 - sideW / 2,
        y: wallH / 2,
        z,
    }));

    // ---- Right panel ----
    panels.push(addWallPanel(scene, world, wallMat, {
        w: sideW, h: wallH,
        x: openingW / 2 + sideW / 2,
        y: wallH / 2,
        z,
    }));

    // ---- Lintel (above the doorway) ----
    panels.push(addWallPanel(scene, world, wallMat, {
        w: openingW, h: lintelH,
        x: 0,
        y: openingH + lintelH / 2,
        z,
    }));

    // Decorative trim around the doorway frame
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x4a3a20, roughness: 0.5, metalness: 0.7 });
    const trimT = 0.08;
    // Left trim
    const trimL = new THREE.Mesh(new THREE.BoxGeometry(trimT, openingH, trimT), trimMat);
    trimL.position.set(-openingW / 2, openingH / 2, z + 0.05);
    trimL.castShadow = true;
    scene.add(trimL);
    // Right trim
    const trimR = new THREE.Mesh(new THREE.BoxGeometry(trimT, openingH, trimT), trimMat);
    trimR.position.set(openingW / 2, openingH / 2, z + 0.05);
    trimR.castShadow = true;
    scene.add(trimR);
    // Top trim
    const trimT_ = new THREE.Mesh(new THREE.BoxGeometry(openingW + trimT, trimT, trimT), trimMat);
    trimT_.position.set(0, openingH, z + 0.05);
    trimT_.castShadow = true;
    scene.add(trimT_);

    return panels;
}

function addWallPanel(scene, world, material, { w, h, x, y, z }) {
    const thickness = 0.15;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, thickness), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Static physics box
    const body = new CANNON.Body({ mass: 0 });
    body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, thickness / 2)));
    body.position.set(x, y, z);
    world.addBody(body);
    return mesh;
}

function addWall(scene, world, { w, h, x, y, z, rotY }) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), concreteMat);
    mesh.rotation.y = rotY;
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Static physics box for collision (thin slab)
    const halfThick = 0.05;
    const box = new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, halfThick));
    const body = new CANNON.Body({ mass: 0 });
    body.addShape(box);
    body.position.set(x, y, z);
    body.quaternion.setFromEuler(0, rotY, 0);
    world.addBody(body);
    return mesh;
}

// ---------------------------------------------------------------------------
// Vault door + hinge
// ---------------------------------------------------------------------------
function createVaultDoor(scene, world, sync) {
    const doorW = 2.0, doorH = 2.6, doorT = 0.3;

    // Door is an empty Group so we can either fill it with the procedural
    // placeholder OR replace its children with the loaded vault_door.glb.
    const doorMesh = new THREE.Group();
    doorMesh.castShadow = true;
    scene.add(doorMesh);

    // ---- Procedural placeholder (visible until vault_door.glb loads) ----
    const slab = new THREE.Mesh(
        new THREE.BoxGeometry(doorW, doorH, doorT),
        new THREE.MeshStandardMaterial({ color: 0x707078, roughness: 0.35, metalness: 0.95 })
    );
    slab.castShadow = true;
    slab.name = 'proceduralPlaceholder';
    doorMesh.add(slab);

    const wheel = new THREE.Mesh(
        new THREE.TorusGeometry(0.32, 0.05, 12, 32),
        steelMat
    );
    wheel.position.set(0, 0, 0.18);
    slab.add(wheel);
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.65, 8), steelMat);
    spoke.rotation.z = Math.PI / 2;
    spoke.position.set(0, 0, 0.18);
    slab.add(spoke);
    const spoke2 = spoke.clone();
    spoke2.rotation.z = 0;
    slab.add(spoke2);

    // ---- Try to load the Blender-built vault_door.glb ----
    const loader = new GLTFLoader();
    loader.load('models/vault_door.glb', (gltf) => {
        console.log('[heist] vault_door.glb loaded successfully');
        // Remove the procedural placeholder
        const placeholder = doorMesh.getObjectByName('proceduralPlaceholder');
        if (placeholder) doorMesh.remove(placeholder);

        const model = gltf.scene;
        model.traverse((c) => { if (c.isMesh) c.castShadow = true; });

        // Flip 180 around Y. Blender's +Y axis (where the wheel handle and
        // rivets were placed in build_assets.py) becomes -Z after GLTF export,
        // which puts the "front" of the door on the far side from the player.
        // Rotating the model 180 around Y faces the front toward the player.
        model.rotation.y = Math.PI;

        // Auto-fit the model to the physics body's expected dimensions.
        // The Blender script outputs a door slightly larger than 2.0 x 2.6 x 0.3
        // because of the bevel and rivets - we scale uniformly so it fits.
        const bbox = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const targetWidth = doorW;
        const scale = targetWidth / Math.max(size.x, 0.001);
        model.scale.setScalar(scale);

        // Re-center on the door group's origin
        bbox.setFromObject(model);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        model.position.sub(center);

        doorMesh.add(model);
    }, undefined, (err) => {
        console.warn('[heist] vault_door.glb not found - using procedural fallback. Did you run build_assets.py?', err);
    });

    // Physics body - dynamic so the hinge can swing it
    const doorBody = new CANNON.Body({
        mass: 30,
        shape: new CANNON.Box(new CANNON.Vec3(doorW / 2, doorH / 2, doorT / 2)),
    });
    // Door starts closed flush with the back wall of the antechamber
    const doorPos = new THREE.Vector3(0, doorH / 2, -4.5);
    doorBody.position.copy(doorPos);
    doorMesh.position.copy(doorPos);
    sync.add(doorMesh, doorBody);

    // Anchor body on the right side - this is what the door hinges to
    const anchor = new CANNON.Body({ mass: 0 });
    anchor.position.set(doorPos.x - doorW / 2, doorPos.y, doorPos.z);
    world.addBody(anchor);

    // HingeConstraint about the vertical (Y) axis at the door's left edge
    const hinge = new CANNON.HingeConstraint(doorBody, anchor, {
        pivotA: new CANNON.Vec3(-doorW / 2, 0, 0),
        pivotB: new CANNON.Vec3(0, 0, 0),
        axisA: new CANNON.Vec3(0, 1, 0),
        axisB: new CANNON.Vec3(0, 1, 0),
    });
    world.addConstraint(hinge);
    // Lock the hinge initially - state machine will release it on unlock
    hinge.enableMotor();
    hinge.setMotorSpeed(0);
    hinge.setMotorMaxForce(1e6);

    return { door: doorMesh, doorBody, hinge };
}

// ---------------------------------------------------------------------------
// Keypad button labels (just visuals - the hacker tool deals with sequence)
// ---------------------------------------------------------------------------
function addKeypadButtons(parent) {
    const labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const btnGeo = new THREE.BoxGeometry(0.06, 0.06, 0.015);
    const btnMat = new THREE.MeshStandardMaterial({ color: 0x444455, emissive: 0x111122 });
    let i = 0;
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            const b = new THREE.Mesh(btnGeo, btnMat.clone());
            b.position.set((c - 1) * 0.085, 0.08 - r * 0.085, 0.025);
            b.userData.label = labels[i++];
            parent.add(b);
        }
    }
    // Status LED
    const led = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0x991111 })
    );
    led.position.set(0, 0.18, 0.025);
    led.name = 'keypadLED';
    parent.add(led);
}

// ---------------------------------------------------------------------------
// Loot items inside the vault
// ---------------------------------------------------------------------------
function createLoot(scene, world, sync) {
    const items = [];
    const inside = -6.5;

    // ---- Five gold coins, scattered on the vault floor ----
    // Coin = thin cylinder (radius 0.06m, height 0.012m). Engraved-look face
    // via a slightly inset second cylinder on top.
    const coinPositions = [
        { x: -0.35, z: inside - 0.1, rot: 0.2 },
        { x: -0.10, z: inside + 0.05, rot: -0.5 },
        { x: 0.15, z: inside - 0.15, rot: 0.8 },
        { x: 0.40, z: inside + 0.10, rot: 1.4 },
        { x: 0.05, z: inside - 0.35, rot: -1.1 },
    ];

    const coinRadius = 0.06;
    const coinHeight = 0.012;

    for (let i = 0; i < coinPositions.length; i++) {
        const { x, z, rot } = coinPositions[i];

        // Outer disc (the coin body)
        const coin = new THREE.Mesh(
            new THREE.CylinderGeometry(coinRadius, coinRadius, coinHeight, 32),
            goldMat.clone()
        );
        coin.castShadow = true;
        coin.position.set(x, 0.05 + i * 0.015, z); // tiny stagger so they don't z-fight
        coin.rotation.y = rot;
        scene.add(coin);

        // Engraved face (slightly raised inner ring for visual detail)
        const face = new THREE.Mesh(
            new THREE.CylinderGeometry(coinRadius * 0.7, coinRadius * 0.7, coinHeight * 1.05, 32),
            new THREE.MeshStandardMaterial({
                color: 0xffaa00,
                roughness: 0.35,
                metalness: 1.0,
                emissive: 0x331a00,
            })
        );
        face.position.y = 0.001;
        coin.add(face);

        // Physics: coin = thin cylinder. Cannon's Cylinder shape has 4 args:
        // (radiusTop, radiusBottom, height, numSegments)
        const body = new CANNON.Body({
            mass: 0.15,
            shape: new CANNON.Cylinder(coinRadius, coinRadius, coinHeight, 16),
        });
        body.position.copy(coin.position);
        body.quaternion.setFromEuler(0, rot, 0);
        sync.add(coin, body);
        coin.userData.lootValue = 500;
        items.push({ mesh: coin, body });
    }

    // Pedestal in the back (decorative)
    const ped = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.5, 0.5, 24),
        new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.9 })
    );
    ped.position.set(0, 0.25, inside - 1.5);
    scene.add(ped);

    return items;
}

function createDuffelBag(scene) {
    // Stylized open bag - just a flat dark trapezoid with a yellow rim
    const group = new THREE.Group();
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.35, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 })
    );
    body.castShadow = true;
    group.add(body);

    const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.28, 0.02, 8, 32),
        new THREE.MeshStandardMaterial({ color: 0xffcc55, emissive: 0x553300 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.18;
    rim.scale.set(1.2, 1, 0.8);
    group.add(rim);

    group.position.set(1.3, 0.18, 0.8);
    scene.add(group);
    return group;
}

function createToolTable(scene) {
    const table = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.05, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.8 })
    );
    table.position.set(2.6, 0.95, 0);
    table.castShadow = true;
    table.receiveShadow = true;
    scene.add(table);

    const legGeo = new THREE.BoxGeometry(0.06, 0.95, 0.06);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 });
    const offsets = [[-0.55, -0.25], [0.55, -0.25], [-0.55, 0.25], [0.55, 0.25]];
    for (const [dx, dz] of offsets) {
        const l = new THREE.Mesh(legGeo, legMat);
        l.position.set(table.position.x + dx, 0.475, table.position.z + dz);
        scene.add(l);
    }
}
