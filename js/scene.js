// Vault room construction.
//
// Builds:
//   - Sealed room (floor, ceiling, 4 walls - no exits except the vault)
//   - Vault dividing wall with a doorway opening, plus a back wall behind it
//   - Vault door with hinge constraint (Cannon-ES) - rivets clustered around
//     the wheel handle, not scattered over the door surface
//   - Keypad, drill bolt, and lockpick keyhole (interaction targets)
//   - Tool pickups on the spawn-side table (lockpick, hacker, drill)
//   - A note on the table that displays the random unlock sequence
//   - Loot (gold coins) inside the vault
//   - Duffel bag drop zone

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildToolMesh } from './tools.js';

// ---- Materials ----
const concreteMat = new THREE.MeshStandardMaterial({ color: 0x383841, roughness: 0.95, metalness: 0.05 });
const steelMat = new THREE.MeshStandardMaterial({ color: 0x6b6b75, roughness: 0.4, metalness: 0.85 });
const goldMat = new THREE.MeshStandardMaterial({ color: 0xffcc33, roughness: 0.25, metalness: 1.0, emissive: 0x000000 });
const rivetMat = new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.5, metalness: 0.9 });

export function buildVaultRoom(scene, world, sync, sequence) {
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

    const spot = new THREE.SpotLight(0xffaa55, 8, 8, Math.PI / 6, 0.4, 1.2);
    spot.position.set(0, 3.5, -1);
    spot.target.position.set(0, 1.3, -4.5);
    scene.add(spot);
    scene.add(spot.target);

    // Light over the table so the player can read the note
    const tableLight = new THREE.PointLight(0xfff0c0, 4, 4, 1.5);
    tableLight.position.set(2.6, 1.8, 0);
    scene.add(tableLight);

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

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), concreteMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, H, -D / 2 + 2);
    scene.add(ceil);

    // ---- Outer walls (sealed - player cannot escape the room) ----
    const blockers = [];
    blockers.push(addWall(scene, world, { w: W, h: H, x: 0, y: H / 2, z: -D + 2, rotY: 0 }));               // back outer wall
    blockers.push(addWall(scene, world, { w: D, h: H, x: -W / 2, y: H / 2, z: -D / 2 + 2, rotY: Math.PI / 2 })); // left
    blockers.push(addWall(scene, world, { w: D, h: H, x: W / 2, y: H / 2, z: -D / 2 + 2, rotY: -Math.PI / 2 })); // right
    blockers.push(addWall(scene, world, { w: W, h: H, x: 0, y: H / 2, z: 2, rotY: Math.PI }));              // front (sealed)

    // ---- Vault dividing wall (with door opening) ----
    const vaultWallPanels = addVaultWall(scene, world, {
        wallW: W, wallH: H, openingW: 2.1, openingH: 2.7, z: -4.8
    });
    blockers.push(...vaultWallPanels);

    // ---- Vault door (procedural, with rivets around the wheel) ----
    const vault = createVaultDoor(scene, world, sync);
    blockers.push(vault.door);

    // ---- Interaction targets ----
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

    // Drill bolt on the door itself
    const boltMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.08, 12),
        new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.5, metalness: 0.9 })
    );
    boltMesh.rotation.x = Math.PI / 2;
    boltMesh.position.set(-0.65, 1.6, -4.34);
    boltMesh.castShadow = true;
    boltMesh.userData.interaction = 'bolt';
    scene.add(boltMesh);

    // ---- Tool table (with physics) + tools + note ----
    createToolTable(scene, world);
    const tableTools = createTableTools(scene, world, sync);
    const sequenceNote = createSequenceNote(scene, sequence);

    // ---- Loot items (inside vault) ----
    const lootItems = createLoot(scene, world, sync);

    // ---- Duffel bag drop zone ----
    const bag = createDuffelBag(scene);

    return {
        door: vault.door,
        doorBody: vault.doorBody,
        hinge: vault.hinge,
        keypad: keypadMesh,
        lock: lockMesh,
        bolt: boltMesh,
        tableTools,
        sequenceNote,
        lootItems,
        bag,
        blockers,
    };
}

// ---------------------------------------------------------------------------
// Vault dividing wall (with doorway opening)
// ---------------------------------------------------------------------------
function addVaultWall(scene, world, { wallW, wallH, openingW, openingH, z }) {
    const sideW = (wallW - openingW) / 2;
    const lintelH = wallH - openingH;

    const wallMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a30, roughness: 0.85, metalness: 0.15,
    });

    const panels = [];
    panels.push(addWallPanel(scene, world, wallMat, {
        w: sideW, h: wallH, x: -openingW / 2 - sideW / 2, y: wallH / 2, z,
    }));
    panels.push(addWallPanel(scene, world, wallMat, {
        w: sideW, h: wallH, x: openingW / 2 + sideW / 2, y: wallH / 2, z,
    }));
    panels.push(addWallPanel(scene, world, wallMat, {
        w: openingW, h: lintelH, x: 0, y: openingH + lintelH / 2, z,
    }));

    // Doorway frame trim
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x4a3a20, roughness: 0.5, metalness: 0.7 });
    const trimT = 0.08;
    const trimL = new THREE.Mesh(new THREE.BoxGeometry(trimT, openingH, trimT), trimMat);
    trimL.position.set(-openingW / 2, openingH / 2, z + 0.05);
    trimL.castShadow = true;
    scene.add(trimL);
    const trimR = new THREE.Mesh(new THREE.BoxGeometry(trimT, openingH, trimT), trimMat);
    trimR.position.set(openingW / 2, openingH / 2, z + 0.05);
    trimR.castShadow = true;
    scene.add(trimR);
    const trimTop = new THREE.Mesh(new THREE.BoxGeometry(openingW + trimT, trimT, trimT), trimMat);
    trimTop.position.set(0, openingH, z + 0.05);
    trimTop.castShadow = true;
    scene.add(trimTop);

    return panels;
}

function addWallPanel(scene, world, material, { w, h, x, y, z }) {
    const thickness = 0.15;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, thickness), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

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
// Vault door + hinge.
// Procedural construction (we skip the GLB on purpose - the rivets in the
// auto-generated GLB were spread across the whole door surface, which looked
// messy. We build a cleaner door here with rivets clustered around the wheel.)
// ---------------------------------------------------------------------------
function createVaultDoor(scene, world, sync) {
    const doorW = 2.15, doorH = 2.6, doorT = 0.3; // slightly wider than the
    // 2.1m opening so the door visually overlaps the wall and there are no gaps

    const doorMesh = new THREE.Group();
    doorMesh.castShadow = true;
    scene.add(doorMesh);

    // Door slab
    const slab = new THREE.Mesh(
        new THREE.BoxGeometry(doorW, doorH, doorT),
        new THREE.MeshStandardMaterial({ color: 0x6a6a72, roughness: 0.35, metalness: 0.95 })
    );
    slab.castShadow = true;
    doorMesh.add(slab);

    // Wheel handle (front-facing)
    const wheel = new THREE.Mesh(
        new THREE.TorusGeometry(0.32, 0.05, 12, 32),
        steelMat
    );
    wheel.position.set(0, 0, doorT / 2 + 0.03);
    slab.add(wheel);

    // Crossing spokes
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.65, 8), steelMat);
    spoke.rotation.z = Math.PI / 2;
    spoke.position.set(0, 0, doorT / 2 + 0.03);
    slab.add(spoke);
    const spoke2 = spoke.clone();
    spoke2.rotation.z = 0;
    slab.add(spoke2);

    // Center hub
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 16), steelMat);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(0, 0, doorT / 2 + 0.05);
    slab.add(hub);

    // Rivets in a TIGHT ring around the wheel (radius 0.46m)
    const rivetGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.04, 10);
    const ringRadius = 0.46;
    for (let i = 0; i < 12; i++) {
        const t = (i / 12) * Math.PI * 2;
        const rivet = new THREE.Mesh(rivetGeo, rivetMat);
        rivet.rotation.x = Math.PI / 2;
        rivet.position.set(Math.cos(t) * ringRadius, Math.sin(t) * ringRadius, doorT / 2 + 0.01);
        slab.add(rivet);
    }

    // Four corner rivets
    const cornerR = 0.04;
    const cornerGeo = new THREE.CylinderGeometry(cornerR, cornerR, 0.04, 10);
    const corners = [[-0.95, 1.15], [0.95, 1.15], [-0.95, -1.15], [0.95, -1.15]];
    for (const [cx, cy] of corners) {
        const r = new THREE.Mesh(cornerGeo, rivetMat);
        r.rotation.x = Math.PI / 2;
        r.position.set(cx, cy, doorT / 2 + 0.01);
        slab.add(r);
    }

    // Physics body - dynamic so the hinge can swing it
    const doorBody = new CANNON.Body({
        mass: 30,
        shape: new CANNON.Box(new CANNON.Vec3(doorW / 2, doorH / 2, doorT / 2)),
    });
    const doorPos = new THREE.Vector3(0, doorH / 2, -4.5);
    doorBody.position.copy(doorPos);
    doorMesh.position.copy(doorPos);
    sync.add(doorMesh, doorBody);

    // Hinge anchor on the right side (so the door swings outward to the left)
    const anchor = new CANNON.Body({ mass: 0 });
    anchor.position.set(doorPos.x - doorW / 2, doorPos.y, doorPos.z);
    world.addBody(anchor);

    const hinge = new CANNON.HingeConstraint(doorBody, anchor, {
        pivotA: new CANNON.Vec3(-doorW / 2, 0, 0),
        pivotB: new CANNON.Vec3(0, 0, 0),
        axisA: new CANNON.Vec3(0, 1, 0),
        axisB: new CANNON.Vec3(0, 1, 0),
    });
    world.addConstraint(hinge);
    hinge.enableMotor();
    hinge.setMotorSpeed(0);
    hinge.setMotorMaxForce(1e6);

    return { door: doorMesh, doorBody, hinge };
}

// ---------------------------------------------------------------------------
// Keypad button labels
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
    const led = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0x991111 })
    );
    led.position.set(0, 0.18, 0.025);
    led.name = 'keypadLED';
    parent.add(led);
}

// ---------------------------------------------------------------------------
// Tool pickups on the spawn table
// Each tool is a grabbable physics object with userData.toolId. When the
// player grabs one, the vault state machine reads that toolId to validate
// proximity-based use against the vault interaction targets.
// ---------------------------------------------------------------------------
function createTableTools(scene, world, sync) {
    const tableY = 1.0; // top of table at y=0.95+thickness/2; place tools just above
    const tableX = 2.6;
    const tableZ = 0;

    const layout = [
        { id: 'lockpick', label: 'LOCKPICK', dx: -0.35, dz: -0.1 },
        { id: 'hacker', label: 'HACKER',     dx:  0.0,  dz:  0.05 },
        { id: 'drill', label: 'DRILL',       dx:  0.35, dz: -0.1 },
    ];

    const tools = [];
    for (const def of layout) {
        const mesh = buildToolMesh(def.id);
        // Stand the tool upright on the table. The procedural builders in
        // tools.js have their grip point near origin and the working tip in +Y.
        mesh.position.set(tableX + def.dx, tableY, tableZ + def.dz);
        mesh.rotation.x = Math.PI / 6; // slight tilt toward the player
        mesh.userData.toolId = def.id;
        mesh.userData.toolName = def.label;
        mesh.userData.isTool = true;
        scene.add(mesh);

        // A simple box collider sized to roughly contain the tool
        const body = new CANNON.Body({
            mass: 0.2,
            shape: new CANNON.Box(new CANNON.Vec3(0.06, 0.1, 0.06)),
        });
        body.position.copy(mesh.position);
        sync.add(mesh, body);

        tools.push({ mesh, body });
    }
    return tools;
}

// ---------------------------------------------------------------------------
// Sequence note - a piece of paper on the table that lists the random
// unlock sequence the player must follow.
// ---------------------------------------------------------------------------
function createSequenceNote(scene, sequence) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 384;
    const ctx = canvas.getContext('2d');

    // Paper background
    ctx.fillStyle = '#f4ecd0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Faint coffee-stain shadow
    ctx.fillStyle = 'rgba(120, 80, 40, 0.08)';
    ctx.beginPath();
    ctx.arc(380, 50, 60, 0, Math.PI * 2);
    ctx.fill();

    // Header
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 36px Georgia, serif';
    ctx.fillText('VAULT INSTRUCTIONS', 50, 60);

    ctx.font = 'italic 22px Georgia, serif';
    ctx.fillStyle = '#3a2a1a';
    ctx.fillText('Follow the steps in order:', 50, 105);

    // Steps
    ctx.font = 'bold 28px Georgia, serif';
    ctx.fillStyle = '#1a1a1a';
    sequence.forEach((step, i) => {
        const y = 165 + i * 50;
        ctx.fillText(`${i + 1}. Use ${step.toolLabel}`, 70, y);
        ctx.font = '22px Georgia, serif';
        ctx.fillText(`   on the ${step.targetLabel}`, 70, y + 28);
        ctx.font = 'bold 28px Georgia, serif';
    });

    // Tip at the bottom
    ctx.font = 'italic 18px Georgia, serif';
    ctx.fillStyle = '#5a4a3a';
    ctx.fillText('(Hold the tool close to its target)', 50, 360);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;

    const noteMat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.95,
        metalness: 0,
        side: THREE.DoubleSide,
    });
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.41), noteMat);
    note.position.set(2.4, 1.001, 0.2);
    note.rotation.x = -Math.PI / 2; // lay flat on the table
    note.rotation.z = -0.1;          // small skew for a casual look
    note.castShadow = false;
    note.receiveShadow = true;
    scene.add(note);
    return note;
}

// ---------------------------------------------------------------------------
// Loot - gold coins inside the vault
// ---------------------------------------------------------------------------
function createLoot(scene, world, sync) {
    const items = [];
    const inside = -6.5;

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

        const coin = new THREE.Mesh(
            new THREE.CylinderGeometry(coinRadius, coinRadius, coinHeight, 32),
            goldMat.clone()
        );
        coin.castShadow = true;
        coin.position.set(x, 0.05 + i * 0.015, z);
        coin.rotation.y = rot;
        scene.add(coin);

        const face = new THREE.Mesh(
            new THREE.CylinderGeometry(coinRadius * 0.7, coinRadius * 0.7, coinHeight * 1.05, 32),
            new THREE.MeshStandardMaterial({
                color: 0xffaa00, roughness: 0.35, metalness: 1.0, emissive: 0x331a00,
            })
        );
        face.position.y = 0.001;
        coin.add(face);

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

    // Pedestal in the back of the vault (decorative)
    const ped = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.5, 0.5, 24),
        new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.9 })
    );
    ped.position.set(0, 0.25, inside - 1.5);
    scene.add(ped);

    return items;
}

// Open treasure chest. The "drop loot here" zone is the top opening.
// Built as a U-shaped wooden box (4 walls + floor, no lid) so the player can
// clearly see where to drop the gold coins. Yellow trim lights up the rim.
function createDuffelBag(scene) {
    const group = new THREE.Group();

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a2c1a, roughness: 0.85 });
    const woodDarkMat = new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.9 });

    const w = 0.7, d = 0.5, wallH = 0.35, wallT = 0.05;

    // Floor
    const floor = new THREE.Mesh(
        new THREE.BoxGeometry(w, wallT, d),
        woodMat
    );
    floor.position.y = wallT / 2;
    floor.receiveShadow = true;
    group.add(floor);

    // Four walls
    const sides = [
        { w, h: wallH, d: wallT, x: 0, y: wallH / 2 + wallT, z: -d / 2 + wallT / 2 },
        { w, h: wallH, d: wallT, x: 0, y: wallH / 2 + wallT, z:  d / 2 - wallT / 2 },
        { w: wallT, h: wallH, d, x: -w / 2 + wallT / 2, y: wallH / 2 + wallT, z: 0 },
        { w: wallT, h: wallH, d, x:  w / 2 - wallT / 2, y: wallH / 2 + wallT, z: 0 },
    ];
    for (const s of sides) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), woodDarkMat);
        wall.position.set(s.x, s.y, s.z);
        wall.castShadow = true;
        group.add(wall);
    }

    // Glowing rim around the opening - signals "drop loot here"
    const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.28, 0.015, 8, 32),
        new THREE.MeshStandardMaterial({
            color: 0xffcc55,
            emissive: 0xffaa00,
            emissiveIntensity: 0.8,
        })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = wallH + wallT + 0.001;
    rim.scale.set(1.2, 1, 0.8);
    group.add(rim);

    // "DROP LOOT" label on the floor of the chest, made with a CanvasTexture
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1208';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#ffcc55';
    ctx.font = 'bold 36px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('DROP LOOT', 128, 64);
    ctx.font = 'italic 22px Georgia, serif';
    ctx.fillText('HERE', 128, 96);
    const labelTex = new THREE.CanvasTexture(canvas);
    labelTex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.25),
        new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.95 })
    );
    label.rotation.x = -Math.PI / 2;
    label.position.y = wallT + 0.001;
    group.add(label);

    group.position.set(1.3, 0, 0.8);
    scene.add(group);
    return group;
}

function createToolTable(scene, world) {
    const tableW = 1.2, tableH = 0.05, tableD = 0.6;
    const tablePos = new THREE.Vector3(2.6, 0.95, 0);

    const table = new THREE.Mesh(
        new THREE.BoxGeometry(tableW, tableH, tableD),
        new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.8 })
    );
    table.position.copy(tablePos);
    table.castShadow = true;
    table.receiveShadow = true;
    scene.add(table);

    // Static physics body so tools rest on the surface instead of falling through
    const tableBody = new CANNON.Body({ mass: 0 });
    tableBody.addShape(new CANNON.Box(new CANNON.Vec3(tableW / 2, tableH / 2, tableD / 2)));
    tableBody.position.copy(tablePos);
    world.addBody(tableBody);

    const legGeo = new THREE.BoxGeometry(0.06, 0.95, 0.06);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 });
    const offsets = [[-0.55, -0.25], [0.55, -0.25], [-0.55, 0.25], [0.55, 0.25]];
    for (const [dx, dz] of offsets) {
        const l = new THREE.Mesh(legGeo, legMat);
        l.position.set(tablePos.x + dx, 0.475, tablePos.z + dz);
        scene.add(l);
    }
}
