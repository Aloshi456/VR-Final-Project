// Physics sync helper - keeps Three.js meshes glued to Cannon-ES bodies.
// (Pattern from Lab 7.)

import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class PhysicsSync {
    constructor(world) {
        this.world = world;
        this.pairs = []; // { mesh, body, kinematic }
        this.byMesh = new Map();
    }

    add(mesh, body, { kinematic = false } = {}) {
        this.world.addBody(body);
        const pair = { mesh, body, kinematic };
        this.pairs.push(pair);
        this.byMesh.set(mesh, pair);
        return pair;
    }

    remove(mesh) {
        const pair = this.byMesh.get(mesh);
        if (!pair) return;
        this.world.removeBody(pair.body);
        this.byMesh.delete(mesh);
        this.pairs = this.pairs.filter(p => p !== pair);
    }

    // Toggle kinematic mode (used while a player holds an object - we don't want
    // physics fighting the controller transform).
    setKinematic(mesh, isKinematic) {
        const pair = this.byMesh.get(mesh);
        if (!pair) return;
        pair.kinematic = isKinematic;
        if (isKinematic) {
            pair.body.type = CANNON.Body.KINEMATIC;
            pair.body.velocity.set(0, 0, 0);
            pair.body.angularVelocity.set(0, 0, 0);
        } else {
            pair.body.type = CANNON.Body.DYNAMIC;
            pair.body.wakeUp();
            // Snap body to mesh world transform on release
            const worldPos = new THREE.Vector3();
            const worldQuat = new THREE.Quaternion();
            mesh.getWorldPosition(worldPos);
            mesh.getWorldQuaternion(worldQuat);
            pair.body.position.set(worldPos.x, worldPos.y, worldPos.z);
            pair.body.quaternion.set(worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w);
        }
    }

    sync() {
        for (const { mesh, body, kinematic } of this.pairs) {
            if (kinematic) continue;
            mesh.position.copy(body.position);
            mesh.quaternion.copy(body.quaternion);
        }
    }
}
