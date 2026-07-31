import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { PartnerBrain, PARTNER_STATES } from '../core/ai/PartnerBrain.js';
import { clamp, damp } from '../utils/math.js';

const ROOM_X_MIN = -CONFIG.room.width * 0.5 + 0.7;
const ROOM_X_MAX = CONFIG.room.width * 0.5 - 0.7;
const ROOM_Z_MIN = -CONFIG.room.depth * 0.5 + 0.7;
const ROOM_Z_MAX = CONFIG.room.depth * 0.5 - 0.7;

const _target = new THREE.Vector3();

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
    this.brain = new PartnerBrain({
      bounds: {
        minX: ROOM_X_MIN,
        maxX: ROOM_X_MAX,
        minZ: ROOM_Z_MIN,
        maxZ: ROOM_Z_MAX,
      },
    });

    this.group = new THREE.Group();
    this.group.name = 'PartnerGhost';
    this.mesh = this.group;
    this.position = this.group.position;
    this.radius = 0.45;
    this.state = PARTNER_STATES.FOLLOW_LEFT;
    this.intent = {
      targetPos: { x: -2.2, y: 0, z: 5.4 },
      faceYaw: 0,
      state: this.state,
      wantDistract: false,
      wantFire: false,
    };
    this.wantDistract = false;
    this.wantFire = false;

    this.visual = new THREE.Group();
    this.group.add(this.visual);
    this.scene.add(this.group);

    this._opacity = CONFIG.attention.fadeMaxOpacity * 0.5;
    this._time = 0;
    this._moveBlend = 0;
    this._aimBlend = 0;
    this._signalBlend = 0;
    this._crouchBlend = 0;
    this._escortBlend = 0;
    this._materials = [
      makeMaterial(0x303946, 0x081014, this._opacity),
      makeMaterial(0x121920, 0x000000, this._opacity),
      makeMaterial(0x62d5cb, 0x1bd6c5, this._opacity),
      makeMaterial(0xffb24a, 0xff8f22, this._opacity),
    ];

    this._buildMesh();
    this.position.set(-2.2, 0, 5.4);
    this.group.renderOrder = 4;
  }

  update(dt, playerPos, playerYaw, context = {}) {
    const safeDt = Math.min(dt, CONFIG.maxFrameDt);
    this._time += safeDt;

    const partnerVisibility = clamp(
      context?.attentionPartnerVis ?? context?.partnerVisibility ?? this.attention?.partnerVisibility ?? 0.5,
      0,
      1,
    );
    this.intent = this.brain.tick({
      ...context,
      dt: safeDt,
      playerPos,
      playerYaw,
      partnerPos: this.position,
      attentionPartnerVis: partnerVisibility,
    });
    this.state = this.intent.state;
    this.wantDistract = this.intent.wantDistract;
    this.wantFire = this.intent.wantFire;

    _target.set(
      clamp(this.intent.targetPos.x, ROOM_X_MIN, ROOM_X_MAX),
      0,
      clamp(this.intent.targetPos.z, ROOM_Z_MIN, ROOM_Z_MAX),
    );

    const beforeX = this.position.x;
    const beforeZ = this.position.z;
    const moveLambda = this._moveLambdaForState(this.state);
    this.position.x = damp(this.position.x, _target.x, moveLambda, safeDt);
    this.position.y = 0;
    this.position.z = damp(this.position.z, _target.z, moveLambda, safeDt);

    const moved = Math.hypot(this.position.x - beforeX, this.position.z - beforeZ);
    const speed = safeDt > 0 ? clamp(moved / (safeDt * 2.4), 0, 1) : 0;
    this._moveBlend = damp(this._moveBlend, speed, 8, safeDt);

    this.group.rotation.y = this._dampAngle(this.group.rotation.y, this.intent.faceYaw, 8, safeDt);

    this._updatePoseTargets(safeDt);
    this._updatePose();
    this._updateOpacity(safeDt, partnerVisibility);
  }

  _buildMesh() {
    const suit = this._materials[0];
    const dark = this._materials[1];
    const glow = this._materials[2];
    const signal = this._materials[3];

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

    this.signalPip = box(0.055, 0.055, 0.018, signal, [-0.45, 1.52, -0.05]);
    this.signalPip.visible = false;
    this.visual.add(this.signalPip);

    this.rifle = new THREE.Group();
    this.rifle.position.set(0.2, 1.0, -0.19);
    this.rifle.rotation.set(0.08, -0.16, -0.18);
    this.rifle.add(box(0.08, 0.07, 0.52, dark, [0, 0, -0.05]));
    this.rifle.add(cyl(0.018, 0.018, 0.32, dark, [0, 0.004, -0.43], [Math.PI * 0.5, 0, 0], 12));
    this.visual.add(this.rifle);
  }

  _updatePoseTargets(dt) {
    const aimState =
      this.state === PARTNER_STATES.WATCH_SECTOR ||
      this.state === PARTNER_STATES.HOLD_COVER ||
      this.state === PARTNER_STATES.EXTRACT_ESCORT;
    const aimTarget = this.wantFire ? 1 : aimState ? 0.58 : 0;
    const signalTarget = this.state === PARTNER_STATES.DRAW_HEAT ? 1 : 0;
    const crouchTarget =
      this.state === PARTNER_STATES.FADE_BACK ? 1 : this.state === PARTNER_STATES.HOLD_COVER ? 0.38 : 0;
    const escortTarget = this.state === PARTNER_STATES.EXTRACT_ESCORT ? 1 : 0;

    this._aimBlend = damp(this._aimBlend, aimTarget, 9, dt);
    this._signalBlend = damp(this._signalBlend, signalTarget, 11, dt);
    this._crouchBlend = damp(this._crouchBlend, crouchTarget, 9, dt);
    this._escortBlend = damp(this._escortBlend, escortTarget, 7, dt);
  }

  _updatePose() {
    const aim = this._aimBlend;
    const signal = this._signalBlend;
    const crouch = this._crouchBlend;
    const escort = this._escortBlend;
    const move = this._moveBlend;
    const pulse = Math.sin(this._time * 8.4) * 0.08;
    const walkBob = Math.sin(this._time * 8.5) * 0.035 * move * (1 - aim * 0.55);

    this.visual.position.y = 0.02 + walkBob - crouch * 0.32;
    this.visual.rotation.z = Math.sin(this._time * 5.7) * 0.025 * move;
    this.visual.rotation.x = crouch * 0.18 - escort * 0.06;
    this.visual.rotation.y = 0;

    this.torso.position.set(0, 1.05 - crouch * 0.08, 0);
    this.torso.rotation.set(0.05 + crouch * 0.34 - aim * 0.04, 0, 0);
    this.chestRig.position.set(0, 1.16 - crouch * 0.08, -0.132);
    this.chestRig.rotation.copy(this.torso.rotation);

    this.head.position.set(0, 1.55 - crouch * 0.18, 0.015);
    this.head.rotation.set(-crouch * 0.16 + signal * 0.1, signal * 0.18, 0);
    this.mask.position.set(0, 1.55 - crouch * 0.18, -0.135);
    this.mask.rotation.copy(this.head.rotation);

    this.leftArm.position.set(-0.32, 1.04 - crouch * 0.14 + signal * 0.18, 0);
    this.rightArm.position.set(0.32, 1.04 - crouch * 0.14, 0);
    this.leftArm.rotation.set(
      0.05 - aim * 0.62 - crouch * 0.1 + signal * 0.2,
      signal * 0.22,
      -0.08 - aim * 0.26 - signal * 2.15,
    );
    this.rightArm.rotation.set(
      0.05 - aim * 0.94 - crouch * 0.08,
      -signal * 0.08,
      0.08 + aim * 0.32 + crouch * 0.12,
    );

    this.leftLeg.position.set(-0.115, 0.42 - crouch * 0.06, 0.02 + crouch * 0.04);
    this.rightLeg.position.set(0.115, 0.42 - crouch * 0.02, 0.02 - crouch * 0.05);
    this.leftLeg.rotation.set(0.02 + crouch * 0.7, 0, 0.035 - crouch * 0.1);
    this.rightLeg.rotation.set(0.02 - crouch * 0.35, 0, -0.035 + crouch * 0.08);
    this.leftBoot.position.set(-0.115, 0.055 - crouch * 0.01, -0.035 + crouch * 0.12);
    this.rightBoot.position.set(0.115, 0.055, -0.035 - crouch * 0.04);

    this.rifle.position.set(
      0.2 - aim * 0.16 + signal * 0.08,
      1.0 + aim * 0.19 - crouch * 0.12 + signal * 0.03,
      -0.19 - aim * 0.08 + signal * 0.07,
    );
    this.rifle.rotation.set(
      0.08 - aim * 0.24 + crouch * 0.18 + signal * 0.18,
      -0.16 + aim * 0.12,
      -0.18 + aim * 0.16 + signal * 0.3,
    );

    this.signalPip.visible = signal > 0.04;
    this.signalPip.position.set(-0.45, 1.52 - crouch * 0.12 + signal * 0.12, -0.05);
    this.signalPip.scale.setScalar(0.45 + signal * (0.65 + pulse));
    this.shoulderGlow.position.set(-0.245, 1.38 - crouch * 0.13, -0.105);
    this.partnerPip.position.set(0, 1.2 - crouch * 0.12, -0.155);
  }

  _updateOpacity(dt, visibility) {
    const min = CONFIG.attention.fadeMinOpacity;
    const max = CONFIG.attention.fadeMaxOpacity;
    const targetOpacity = min + (max - min) * clamp(visibility, 0, 1);

    this._opacity = damp(this._opacity, targetOpacity, 8, dt);
    for (const material of this._materials) {
      material.opacity = this._opacity;
    }
    this._materials[2].emissiveIntensity = 0.2 + this._opacity * 1.4;
    this._materials[3].opacity = this._opacity * clamp(0.2 + this._signalBlend, 0, 1);
    this._materials[3].emissiveIntensity = 0.2 + this._signalBlend * 1.7;
  }

  _moveLambdaForState(state) {
    switch (state) {
      case PARTNER_STATES.HOLD_COVER:
      case PARTNER_STATES.FADE_BACK:
        return 5.6;
      case PARTNER_STATES.DRAW_HEAT:
      case PARTNER_STATES.EXTRACT_ESCORT:
        return 4.8;
      case PARTNER_STATES.WATCH_SECTOR:
        return 4.2;
      default:
        return 3.8;
    }
  }

  _dampAngle(current, target, lambda, dt) {
    let delta = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return current + delta * (1 - Math.exp(-lambda * dt));
  }
}
