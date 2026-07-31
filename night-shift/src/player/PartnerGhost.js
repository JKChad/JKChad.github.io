import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, damp } from '../utils/math.js';

const ROOM_X_MIN = -CONFIG.room.width * 0.5 + 0.7;
const ROOM_X_MAX = CONFIG.room.width * 0.5 - 0.7;
const ROOM_Z_MIN = -CONFIG.room.depth * 0.5 + 0.7;
const ROOM_Z_MAX = CONFIG.room.depth * 0.5 - 0.7;

const _target = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();

function makeMaterial(color, emissive = 0x000000, opacity = 0.5) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive ? 0.55 : 0,
    roughness: 0.78,
    metalness: 0.08,
    transparent: true,
    opacity,
    depthWrite: false,
  });
}

function box(w, h, d, material, position, rotation = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.fromArray(position);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = true;
  return mesh;
}

function cyl(radiusTop, radiusBottom, height, material, position, rotation = null, segments = 16) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material,
  );
  mesh.position.fromArray(position);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = true;
  return mesh;
}

export class PartnerGhost {
  constructor(scene, attention) {
    this.scene = scene;
    this.attention = attention;
    this.group = new THREE.Group();
    this.group.name = 'PartnerGhost';
    this.mesh = this.group;
    this.position = this.group.position;
    this.radius = 0.45;

    this.visual = new THREE.Group();
    this.group.add(this.visual);
    this.scene.add(this.group);

    this._opacity = CONFIG.attention.fadeMaxOpacity * 0.5;
    this._time = 0;
    this._materials = [
      makeMaterial(0x303946, 0x081014, this._opacity),
      makeMaterial(0x121920, 0x000000, this._opacity),
      makeMaterial(0x62d5cb, 0x1bd6c5, this._opacity),
    ];

    this._buildMesh();
    this.position.set(-2.2, 0, 5.4);
    this.group.renderOrder = 4;
  }

  update(dt, playerPos, playerYaw) {
    const safeDt = Math.min(dt, CONFIG.maxFrameDt);
    this._time += safeDt;

    _forward.set(-Math.sin(playerYaw), 0, -Math.cos(playerYaw));
    _right.set(Math.cos(playerYaw), 0, -Math.sin(playerYaw));

    const orbit = Math.sin(this._time * 0.47);
    const sidestep = -2.05 + Math.sin(this._time * 0.73) * 0.75;
    const depth = -1.55 + Math.cos(this._time * 0.41) * 0.7 + orbit * 0.25;

    _target.copy(playerPos);
    _target.addScaledVector(_right, sidestep);
    _target.addScaledVector(_forward, depth);
    _target.x = clamp(_target.x, ROOM_X_MIN, ROOM_X_MAX);
    _target.y = 0;
    _target.z = clamp(_target.z, ROOM_Z_MIN, ROOM_Z_MAX);

    this.position.x = damp(this.position.x, _target.x, 3.8, safeDt);
    this.position.y = 0;
    this.position.z = damp(this.position.z, _target.z, 3.8, safeDt);

    const desiredYaw = Math.atan2(playerPos.x - this.position.x, playerPos.z - this.position.z);
    this.group.rotation.y = this._dampAngle(this.group.rotation.y, desiredYaw, 7.5, safeDt);

    const walkBob = Math.sin(this._time * 5.1) * 0.035;
    const idleBob = Math.sin(this._time * 1.7) * 0.025;
    this.visual.position.y = 0.02 + walkBob + idleBob;
    this.visual.rotation.z = Math.sin(this._time * 1.2) * 0.025;
    this.visual.rotation.x = Math.sin(this._time * 0.95) * 0.015;

    this._updateOpacity(safeDt);
  }

  _buildMesh() {
    const suit = this._materials[0];
    const dark = this._materials[1];
    const glow = this._materials[2];

    this.torso = box(0.44, 0.72, 0.24, suit, [0, 1.05, 0], [0.05, 0, 0]);
    this.visual.add(this.torso);

    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 12), suit);
    this.head.position.set(0, 1.55, 0.015);
    this.head.castShadow = true;
    this.visual.add(this.head);

    this.mask = box(0.19, 0.08, 0.025, dark, [0, 1.55, -0.135]);
    this.visual.add(this.mask);

    this.chestRig = box(0.34, 0.18, 0.035, dark, [0, 1.16, -0.132]);
    this.visual.add(this.chestRig);

    this.leftArm = cyl(0.055, 0.06, 0.58, suit, [-0.32, 1.04, 0], [0.05, 0, -0.08], 12);
    this.rightArm = cyl(0.055, 0.06, 0.58, suit, [0.32, 1.04, 0], [0.05, 0, 0.08], 12);
    this.visual.add(this.leftArm, this.rightArm);

    this.leftLeg = cyl(0.075, 0.065, 0.72, suit, [-0.115, 0.42, 0.02], [0.02, 0, 0.035], 12);
    this.rightLeg = cyl(0.075, 0.065, 0.72, suit, [0.115, 0.42, 0.02], [0.02, 0, -0.035], 12);
    this.visual.add(this.leftLeg, this.rightLeg);

    this.leftBoot = box(0.14, 0.08, 0.22, dark, [-0.115, 0.055, -0.035]);
    this.rightBoot = box(0.14, 0.08, 0.22, dark, [0.115, 0.055, -0.035]);
    this.visual.add(this.leftBoot, this.rightBoot);

    this.shoulderGlow = box(0.06, 0.018, 0.032, glow, [-0.245, 1.38, -0.105]);
    this.partnerPip = box(0.05, 0.045, 0.012, glow, [0.0, 1.2, -0.155]);
    this.visual.add(this.shoulderGlow, this.partnerPip);

    this.rifle = new THREE.Group();
    this.rifle.position.set(0.2, 1.0, -0.19);
    this.rifle.rotation.set(0.08, -0.16, -0.18);
    this.rifle.add(box(0.08, 0.07, 0.52, dark, [0, 0, -0.05]));
    this.rifle.add(cyl(0.018, 0.018, 0.32, dark, [0, 0.004, -0.43], [Math.PI * 0.5, 0, 0], 12));
    this.visual.add(this.rifle);
  }

  _updateOpacity(dt) {
    const visibility = this.attention?.partnerVisibility ?? 0.5;
    const min = CONFIG.attention.fadeMinOpacity;
    const max = CONFIG.attention.fadeMaxOpacity;
    const targetOpacity = min + (max - min) * clamp(visibility, 0, 1);

    this._opacity = damp(this._opacity, targetOpacity, 8, dt);
    for (const material of this._materials) {
      material.opacity = this._opacity;
    }
    this._materials[2].emissiveIntensity = 0.2 + this._opacity * 1.4;
  }

  _dampAngle(current, target, lambda, dt) {
    let delta = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return current + delta * (1 - Math.exp(-lambda * dt));
  }
}
