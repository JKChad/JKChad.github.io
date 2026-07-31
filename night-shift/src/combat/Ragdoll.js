import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from '../config.js';

const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _impulse = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _relative = new CANNON.Vec3();
const COLLISION_GROUPS = Object.freeze({
  ragdoll: 1,
  world: 2,
});

function toCannonVec3(vector) {
  return new CANNON.Vec3(vector.x, vector.y, vector.z);
}

function toCannonQuat(quaternion) {
  return new CANNON.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
}

export class Ragdoll {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.freezeAfter = options.freezeAfter ?? 3;
    this.maxActive = options.maxActive ?? 4;
    this.active = [];
    this.worldBodies = [];

    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0),
    });
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.friction = 0.55;
    this.world.defaultContactMaterial.restitution = 0.08;
    this.worldMaterial = new CANNON.Material('ragdoll-world');
    this.ragdollMaterial = new CANNON.Material('ragdoll-body');

    this._addRoomColliders();

    this.material = new THREE.MeshStandardMaterial({
      color: 0x2a2f38,
      roughness: 0.78,
      metalness: 0.05,
    });
  }

  spawnRagdoll(fromMesh, impulseDir, hitPoint) {
    if (!fromMesh) return null;
    while (this.active.length >= this.maxActive) {
      this._disposeRagdoll(this.active[0]);
    }

    _box.setFromObject(fromMesh);
    if (_box.isEmpty()) {
      fromMesh.getWorldPosition(_center);
      _size.set(0.55, 1.75, 0.35);
    } else {
      _box.getCenter(_center);
      _box.getSize(_size);
      if (_size.y < 0.5) _size.set(Math.max(_size.x, 0.55), 1.75, Math.max(_size.z, 0.35));
    }
    fromMesh.getWorldQuaternion(_quat);

    fromMesh.traverse?.((object) => {
      object.visible = false;
      object.userData.combatIgnore = true;
      object.userData.dead = true;
    });
    fromMesh.visible = false;
    fromMesh.userData.dead = true;

    _impulse.copy(impulseDir || new THREE.Vector3(0, 0, -1));
    if (_impulse.lengthSq() < 0.001) _impulse.set(0, 0, -1);
    _impulse.normalize();

    const width = Math.max(_size.x, 0.45);
    const height = Math.max(_size.y, 1.45);
    const depth = Math.max(_size.z, 0.28);
    const group = new THREE.Group();
    group.name = 'combat-ragdoll';
    group.userData.isRagdoll = true;
    group.userData.combatIgnore = true;
    this.scene.add(group);

    const ragdoll = {
      group,
      bodies: [],
      meshes: [],
      constraints: [],
      age: 0,
      frozen: false,
    };

    const makePart = (name, dims, localOffset, mass) => {
      _offset.copy(localOffset).applyQuaternion(_quat).add(_center);

      const geometry = new THREE.BoxGeometry(dims.x, dims.y, dims.z);
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = `ragdoll-${name}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.isRagdoll = true;
      mesh.userData.combatIgnore = true;
      mesh.position.copy(_offset);
      mesh.quaternion.copy(_quat);
      group.add(mesh);

      const body = new CANNON.Body({
        mass,
        shape: new CANNON.Box(new CANNON.Vec3(dims.x / 2, dims.y / 2, dims.z / 2)),
        position: toCannonVec3(_offset),
        quaternion: toCannonQuat(_quat),
        material: this.ragdollMaterial,
        collisionFilterGroup: COLLISION_GROUPS.ragdoll,
        collisionFilterMask: COLLISION_GROUPS.world,
        linearDamping: 0.38,
        angularDamping: 0.46,
      });
      body.velocity.set(_impulse.x * 0.75, 0.35 + Math.random() * 0.35, _impulse.z * 0.75);
      body.angularVelocity.set(
        (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 0.9,
        (Math.random() - 0.5) * 1.2
      );

      this.world.addBody(body);
      ragdoll.bodies.push(body);
      ragdoll.meshes.push(mesh);
      return { body, mesh, dims };
    };

    const hips = makePart(
      'hips',
      new THREE.Vector3(width * 0.72, height * 0.16, depth * 0.75),
      new THREE.Vector3(0, -height * 0.24, 0),
      4
    );
    const torso = makePart(
      'torso',
      new THREE.Vector3(width * 0.78, height * 0.32, depth * 0.68),
      new THREE.Vector3(0, height * 0.04, 0),
      6
    );
    const head = makePart(
      'head',
      new THREE.Vector3(width * 0.38, height * 0.15, width * 0.38),
      new THREE.Vector3(0, height * 0.31, 0),
      1.25
    );
    const leftArm = makePart(
      'left-arm',
      new THREE.Vector3(width * 0.18, height * 0.34, depth * 0.28),
      new THREE.Vector3(-width * 0.58, height * 0.03, 0),
      1.4
    );
    const rightArm = makePart(
      'right-arm',
      new THREE.Vector3(width * 0.18, height * 0.34, depth * 0.28),
      new THREE.Vector3(width * 0.58, height * 0.03, 0),
      1.4
    );
    const legs = makePart(
      'legs',
      new THREE.Vector3(width * 0.58, height * 0.38, depth * 0.55),
      new THREE.Vector3(0, -height * 0.53, 0),
      4.5
    );

    this._connect(ragdoll, hips.body, new CANNON.Vec3(0, height * 0.08, 0), torso.body, new CANNON.Vec3(0, -height * 0.16, 0));
    this._connect(ragdoll, torso.body, new CANNON.Vec3(0, height * 0.18, 0), head.body, new CANNON.Vec3(0, -height * 0.075, 0));
    this._connect(
      ragdoll,
      torso.body,
      new CANNON.Vec3(-width * 0.42, height * 0.07, 0),
      leftArm.body,
      new CANNON.Vec3(0, height * 0.14, 0)
    );
    this._connect(
      ragdoll,
      torso.body,
      new CANNON.Vec3(width * 0.42, height * 0.07, 0),
      rightArm.body,
      new CANNON.Vec3(0, height * 0.14, 0)
    );
    this._connect(ragdoll, hips.body, new CANNON.Vec3(0, -height * 0.08, 0), legs.body, new CANNON.Vec3(0, height * 0.18, 0));

    this._applyHitImpulse(ragdoll, hitPoint, _impulse);
    this.active.push(ragdoll);
    return group;
  }

  update(dt) {
    if (this.active.some((ragdoll) => !ragdoll.frozen)) {
      this.world.step(1 / 60, Math.min(dt, 0.05), 3);
    }

    for (const ragdoll of this.active) {
      if (ragdoll.frozen) continue;
      ragdoll.age += dt;
      for (let i = 0; i < ragdoll.bodies.length; i++) {
        const body = ragdoll.bodies[i];
        const mesh = ragdoll.meshes[i];
        mesh.position.set(body.position.x, body.position.y, body.position.z);
        mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      }
      if (ragdoll.age >= this.freezeAfter) this._freeze(ragdoll);
    }
  }

  _connect(ragdoll, bodyA, pivotA, bodyB, pivotB) {
    const constraint = new CANNON.PointToPointConstraint(bodyA, pivotA, bodyB, pivotB, 1e5);
    this.world.addConstraint(constraint);
    ragdoll.constraints.push(constraint);
  }

  _addRoomColliders() {
    const width = CONFIG.room?.width ?? 28;
    const depth = CONFIG.room?.depth ?? 22;
    const height = CONFIG.room?.height ?? 3.6;
    const wallT = 0.32;

    this._addWorldBox(
      'floor',
      new CANNON.Vec3(width / 2, 0.08, depth / 2),
      new CANNON.Vec3(0, -0.08, 0)
    );
    this._addWorldBox(
      'left-wall',
      new CANNON.Vec3(wallT / 2, height / 2, depth / 2),
      new CANNON.Vec3(-width / 2 - wallT / 2, height / 2, 0)
    );
    this._addWorldBox(
      'right-wall',
      new CANNON.Vec3(wallT / 2, height / 2, depth / 2),
      new CANNON.Vec3(width / 2 + wallT / 2, height / 2, 0)
    );
    this._addWorldBox(
      'rear-wall',
      new CANNON.Vec3(width / 2, height / 2, wallT / 2),
      new CANNON.Vec3(0, height / 2, -depth / 2 - wallT / 2)
    );
    this._addWorldBox(
      'front-wall',
      new CANNON.Vec3(width / 2, height / 2, wallT / 2),
      new CANNON.Vec3(0, height / 2, depth / 2 + wallT / 2)
    );
  }

  _addWorldBox(name, halfExtents, position) {
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(halfExtents),
      position,
      material: this.worldMaterial,
      collisionFilterGroup: COLLISION_GROUPS.world,
      collisionFilterMask: COLLISION_GROUPS.ragdoll,
    });
    body.name = `ragdoll-${name}-collider`;
    this.world.addBody(body);
    this.worldBodies.push(body);
  }

  _applyHitImpulse(ragdoll, hitPoint, direction) {
    const point = hitPoint?.isVector3 ? _hit.copy(hitPoint) : _hit.copy(_center);
    let best = null;
    let bestDistance = Infinity;
    for (const body of ragdoll.bodies) {
      const dx = point.x - body.position.x;
      const dy = point.y - body.position.y;
      const dz = point.z - body.position.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq < bestDistance) {
        bestDistance = distanceSq;
        best = body;
      }
    }
    if (!best) return;

    _relative.set(point.x - best.position.x, point.y - best.position.y, point.z - best.position.z);
    const strength = 5.5 + best.mass * 0.8;
    best.applyImpulse(
      new CANNON.Vec3(
        direction.x * strength,
        Math.max(1.2, direction.y * strength + 1.8),
        direction.z * strength
      ),
      _relative
    );
  }

  _freeze(ragdoll) {
    if (ragdoll.frozen) return;
    ragdoll.frozen = true;
    for (const constraint of ragdoll.constraints) this.world.removeConstraint(constraint);
    for (const body of ragdoll.bodies) this.world.removeBody(body);
    ragdoll.constraints.length = 0;
    ragdoll.bodies.length = 0;
    for (const mesh of ragdoll.meshes) {
      mesh.userData.combatIgnore = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
    }
  }

  _disposeRagdoll(ragdoll) {
    if (!ragdoll) return;
    this._freeze(ragdoll);
    this.scene.remove(ragdoll.group);
    for (const mesh of ragdoll.meshes) {
      mesh.geometry?.dispose?.();
    }
    const index = this.active.indexOf(ragdoll);
    if (index >= 0) this.active.splice(index, 1);
  }

  dispose() {
    for (const ragdoll of [...this.active]) this._disposeRagdoll(ragdoll);
    for (const body of this.worldBodies) this.world.removeBody(body);
    this.worldBodies.length = 0;
    this.material.dispose();
  }
}
