import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp } from '../utils/math.js';
import { createPatrolPath, PatrolBrain } from './Patrol.js';

const EYE_HEIGHT = 1.68;
const ALERT_SUSPICION = 0.24;
const INVESTIGATE_SUSPICION = 0.56;
const VISUAL_GRACE = 0.42;
const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
const _tmpC = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Guard {
  constructor(scene, bus, patrolPath = createPatrolPath()) {
    this.scene = scene;
    this.bus = bus;
    this.mesh = this._createHumanoid();
    this.position = this.mesh.position;
    this.forward = new THREE.Vector3(0, 0, 1);
    this.alive = true;
    this.suspicion = 0;
    this.state = 'patrol';
    this.hp = 100;
    this.flashlightRange = 12;
    this.flashlightFov = Math.PI / 7;
    this.lastSeenPos = null;
    this.confidence = 0;
    this.visualContactTimer = 0;

    this.patrol = new PatrolBrain(patrolPath);
    this.investigationPoint = null;
    this.investigationKind = null;
    this.investigateTimer = 0;
    this.alertLookTimer = 0;
    this.searchLostTimer = 0;
    this.searchAnchor = null;
    this.combatShotTimer = 0.45;
    this.combatStrafePhase = Math.random() * Math.PI * 2;

    const first = this.patrol.currentWaypoint;
    if (first) {
      this.position.copy(first);
      this.patrol.index = this.patrol.waypoints.length > 1 ? 1 : 0;
      const next = this.patrol.currentWaypoint;
      if (next) this._turnImmediatelyToward(next);
    }

    scene.add(this.mesh);
    this._createFlashlight();
    this._updateFacing();
    this._updateFlashlight();
  }

  update(dt, player, mode, combat) {
    if (!this.alive || this.state === 'dead') return;

    if (mode === 'loud' && this.state !== 'combat') {
      this.enterCombat();
    }

    this.visualContactTimer = Math.max(0, this.visualContactTimer - dt);
    this.confidence = clamp(this.confidence - dt * 0.18, 0, 1);

    if (this.state === 'chase' && this.visualContactTimer <= 0 && this.lastSeenPos) {
      this.loseVisual();
    }

    switch (this.state) {
      case 'alertLook':
        this._updateAlertLook(dt);
        break;
      case 'investigate':
        this._updateInvestigate(dt);
        break;
      case 'chase':
        this._updateChase(dt, player);
        break;
      case 'searchLost':
        this._updateSearchLost(dt);
        break;
      case 'combat':
        this._updateCombat(dt, player, combat);
        break;
      case 'patrol':
      default:
        this._updatePatrol(dt);
        break;
    }

    this.suspicion = clamp(this.suspicion, 0, CONFIG.guard.alarmThreshold);
    this._updateFacing();
    this._updateFlashlight();
  }

  hearNoise(position, kind = 'noise') {
    if (!this.alive || this.state === 'dead' || this.state === 'combat') return;
    if (!position) return;

    this.investigationPoint = toVector3(position).clone();
    this.investigationKind = kind;
    this.investigateTimer = kind === 'shot' ? 0.25 : 1.35;
    this.suspicion = clamp(
      this.suspicion + (kind === 'shot' ? 0.75 : kind === 'cough' ? 0.35 : 0.25),
      0,
      CONFIG.guard.alarmThreshold,
    );
    this._setState(kind === 'shot' ? 'chase' : 'investigate');
  }

  noticeVisual(position, confidence = 0) {
    if (!this.alive || this.state === 'dead' || this.state === 'combat') return;
    if (!position) return;

    const seen = toVector3(position).clone();
    this.lastSeenPos = seen;
    this.investigationPoint = seen.clone();
    this.investigationKind = 'sighting';
    this.visualContactTimer = VISUAL_GRACE;
    this.confidence = clamp(Math.max(this.confidence, confidence), 0, 1);

    if (this.suspicion >= CONFIG.guard.alarmThreshold) {
      this._setState('chase');
      return;
    }

    if (this.state === 'chase') return;

    if (this.suspicion >= INVESTIGATE_SUSPICION || this.confidence >= 0.48) {
      this.investigateTimer = Math.max(this.investigateTimer, 1.0);
      this._setState('investigate');
      return;
    }

    if (this.suspicion >= ALERT_SUSPICION || this.confidence >= 0.2) {
      this.alertLookTimer = Math.max(this.alertLookTimer, 0.75);
      this._setState('alertLook');
    }
  }

  loseVisual() {
    if (!this.alive || this.state === 'dead' || this.state === 'combat') return;
    if (!this.lastSeenPos) return;
    if (!['alertLook', 'investigate', 'chase'].includes(this.state)) return;

    this.searchAnchor = this.lastSeenPos.clone();
    this.investigationPoint = this.searchAnchor.clone();
    this.investigationKind = 'lostVisual';
    this.searchLostTimer = this.state === 'chase' ? 3.2 : 1.8;
    this._setState('searchLost');
  }

  enterCombat() {
    if (!this.alive || this.state === 'dead') return;
    this.suspicion = CONFIG.guard.alarmThreshold;
    this.combatShotTimer = Math.min(this.combatShotTimer, 0.25);
    this._setState('combat');
  }

  takeDamage(amount, hitPoint = null, impulse = null) {
    if (!this.alive || this.state === 'dead') return;

    this.hp -= Math.max(0, amount);
    this.bus?.emit('guard:damaged', {
      guard: this,
      amount,
      hp: Math.max(0, this.hp),
      hitPoint: hitPoint?.clone?.() ?? hitPoint,
      impulse: impulse?.clone?.() ?? impulse,
    });

    if (this.hp <= 0) {
      this._die(hitPoint, impulse);
      return;
    }

    this.enterCombat();
  }

  getEyePosition(out = new THREE.Vector3()) {
    return out.copy(this.position).add(new THREE.Vector3(0, EYE_HEIGHT, 0));
  }

  investigate(position, kind = 'sighting') {
    this.hearNoise(position, kind);
  }

  _updatePatrol(dt) {
    this.patrol.update(dt, this.position, this.forward, CONFIG.guard.patrolSpeed);
  }

  _updateAlertLook(dt) {
    const lookPoint = this.lastSeenPos ?? this.investigationPoint;
    if (!lookPoint) {
      this._setState('patrol');
      return;
    }

    _tmpA.subVectors(lookPoint, this.position);
    _tmpA.y = 0;
    if (_tmpA.lengthSq() > 0.0001) this._turnToward(_tmpA.normalize(), dt, 18);

    this.alertLookTimer -= dt;
    if (this.suspicion >= INVESTIGATE_SUSPICION || this.confidence >= 0.42) {
      this.investigateTimer = Math.max(this.investigateTimer, 1.1);
      this._setState('investigate');
    } else if (this.alertLookTimer <= 0) {
      this.investigateTimer = Math.max(this.investigateTimer, 0.9);
      this._setState('investigate');
    }
  }

  _updateInvestigate(dt) {
    if (!this.investigationPoint) {
      this._setState('patrol');
      return;
    }

    const arrived = this._moveToward(this.investigationPoint, CONFIG.guard.patrolSpeed * 1.25, dt, 0.55);
    if (arrived) {
      this.investigateTimer -= dt;
      const scanYaw = Math.sin(performance.now() * 0.0025) * 0.75;
      _tmpA.subVectors(this.investigationPoint, this.position);
      _tmpA.y = 0;
      if (_tmpA.lengthSq() > 0.0001) {
        _tmpA.normalize().applyAxisAngle(_up, scanYaw);
        this._turnToward(_tmpA, dt, 4.5);
      }

      if (this.investigateTimer <= 0) {
        if (this.investigationKind === 'sighting' && this.lastSeenPos) {
          this.loseVisual();
        } else {
          this.investigationPoint = null;
          this.investigationKind = null;
          this._setState('patrol');
        }
      }
    }
  }

  _updateChase(dt, player) {
    const hasLiveVisual = this.visualContactTimer > 0 && this.investigationPoint;
    const target = hasLiveVisual ? _tmpA.copy(this.investigationPoint) : getEntityPosition(player, _tmpA);
    if (!target) {
      this.loseVisual();
      return;
    }

    if (hasLiveVisual) this.lastSeenPos = target.clone();
    this.investigationPoint = target.clone();
    const arrived = this._moveToward(target, CONFIG.guard.chaseSpeed, dt, 1.4);
    if (arrived) {
      if (hasLiveVisual) {
        this._setState('combat');
      } else {
        this.loseVisual();
      }
    }
  }

  _updateSearchLost(dt) {
    const anchor = this.searchAnchor ?? this.lastSeenPos;
    if (!anchor) {
      this._setState('patrol');
      return;
    }

    const arrived = this._moveToward(anchor, CONFIG.guard.patrolSpeed * 1.15, dt, 0.7);
    if (arrived) {
      this.searchLostTimer -= dt;
      const scanYaw = Math.sin(performance.now() * 0.0032) * 1.15;
      _tmpA.subVectors(anchor, this.position);
      _tmpA.y = 0;
      if (_tmpA.lengthSq() <= 0.0001) _tmpA.copy(this.forward);
      _tmpA.normalize().applyAxisAngle(_up, scanYaw);
      this._turnToward(_tmpA, dt, 6.2);
    }

    if (this.searchLostTimer <= 0) {
      this.searchAnchor = null;
      this.investigationPoint = null;
      this.investigationKind = null;
      this.lastSeenPos = null;
      this._setState('patrol');
    }
  }

  _updateCombat(dt, player) {
    const target = getEntityPosition(player, _tmpA);
    if (!target) return;

    _tmpB.subVectors(target, this.position);
    _tmpB.y = 0;
    const distance = _tmpB.length();
    if (distance > 0.0001) this._turnToward(_tmpB.multiplyScalar(1 / distance), dt, 12);

    const right = _tmpC.set(this.forward.z, 0, -this.forward.x).normalize();
    const strafe = Math.sin((this.combatStrafePhase += dt * 1.7)) * 0.45;
    const advance = distance > 7 ? 1 : distance < 3 ? -0.55 : 0.1;
    this.position.addScaledVector(this.forward, advance * CONFIG.guard.patrolSpeed * dt);
    this.position.addScaledVector(right, strafe * CONFIG.guard.patrolSpeed * dt);

    this.combatShotTimer -= dt;
    if (this.combatShotTimer <= 0) {
      this.combatShotTimer = 0.72 + Math.random() * 0.28;
      this._shootAt(target);
    }
  }

  _moveToward(target, speed, dt, stopDistance) {
    _tmpB.subVectors(target, this.position);
    _tmpB.y = 0;
    const distance = _tmpB.length();
    if (distance <= stopDistance) return true;

    _tmpB.multiplyScalar(1 / Math.max(distance, 0.0001));
    this._turnToward(_tmpB, dt, 9);

    const alignment = clamp(this.forward.dot(_tmpB), -1, 1);
    const stepScale = clamp((alignment + 0.5) / 1.5, 0.25, 1);
    this.position.addScaledVector(this.forward, Math.min(distance - stopDistance, speed * stepScale * dt));
    return false;
  }

  _shootAt(target) {
    const origin = this.getEyePosition(_tmpA);
    const aimPoint = _tmpB.copy(target);
    if (aimPoint.y < EYE_HEIGHT * 0.5) aimPoint.y += 1.2;
    const dir = aimPoint.sub(origin).normalize();

    this.bus?.emit('guard:shot', {
      guard: this,
      origin: origin.clone(),
      dir: dir.clone(),
    });
  }

  _die(hitPoint, impulse) {
    this.alive = false;
    this._setState('dead');
    this.mesh.userData.dead = true;
    this.mesh.traverse((child) => {
      child.userData.dead = true;
      if (child.isLight) child.intensity = 0;
    });
    this.bus?.emit('guard:killed', {
      guard: this,
      hitPoint: hitPoint?.clone?.() ?? hitPoint,
      impulse: impulse?.clone?.() ?? impulse,
    });
  }

  _setState(state) {
    if (this.state === state) return;
    const previous = this.state;
    this.state = state;
    if (state === 'alertLook' && this.lastSeenPos) {
      this._turnImmediatelyToward(this.lastSeenPos);
    }
    this.bus?.emit('guard:state', { guard: this, state, previous });
  }

  _turnImmediatelyToward(target) {
    _tmpA.subVectors(target, this.position);
    _tmpA.y = 0;
    if (_tmpA.lengthSq() > 0.0001) this.forward.copy(_tmpA.normalize());
  }

  _turnToward(direction, dt, rate = 8) {
    if (!direction || direction.lengthSq() < 0.0001) return;
    this.forward.lerp(direction, 1 - Math.exp(-rate * dt)).normalize();
  }

  _updateFacing() {
    this.mesh.rotation.y = Math.atan2(this.forward.x, this.forward.z);
  }

  _updateFlashlight() {
    if (!this.flashlight || !this.flashlightTarget) return;

    const eye = this.getEyePosition(_tmpA);
    this.flashlight.position.copy(this.mesh.worldToLocal(eye.clone()));
    this.flashlight.distance = this.flashlightRange;
    this.flashlight.angle = this.flashlightFov;
    this.flashlightTarget.position.copy(eye).addScaledVector(this.forward, this.flashlightRange);
    this.flashlightTarget.position.y -= 0.35;
  }

  _createHumanoid() {
    const root = new THREE.Group();
    root.name = 'Guard';
    root.userData.guard = this;
    root.userData.perceptionIgnore = true;

    const uniform = new THREE.MeshStandardMaterial({
      color: 0x1f2630,
      roughness: 0.72,
      metalness: 0.05,
      emissive: 0x080b10,
      emissiveIntensity: 0.35,
    });
    const skin = new THREE.MeshStandardMaterial({
      color: 0x8c6a4f,
      roughness: 0.85,
      emissive: 0x100805,
      emissiveIntensity: 0.15,
    });
    const vest = new THREE.MeshStandardMaterial({
      color: 0x0b0f14,
      roughness: 0.8,
      emissive: 0x0a1018,
      emissiveIntensity: 0.45,
    });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.82, 0.34), uniform);
    torso.name = 'GuardTorso';
    torso.position.y = 1.18;
    torso.castShadow = true;
    root.add(torso);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.38), vest);
    chest.name = 'GuardVest';
    chest.position.set(0, 1.25, 0.025);
    chest.castShadow = true;
    root.add(chest);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), skin);
    head.name = 'GuardHead';
    head.position.y = 1.78;
    head.castShadow = true;
    root.add(head);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.34), vest);
    cap.name = 'GuardCap';
    cap.position.y = 1.96;
    cap.castShadow = true;
    root.add(cap);

    this._addLimb(root, 'GuardLeftArm', -0.42, 1.16, 0.02, uniform);
    this._addLimb(root, 'GuardRightArm', 0.42, 1.16, 0.02, uniform);
    this._addLimb(root, 'GuardLeftLeg', -0.17, 0.48, 0, uniform, 0.18, 0.82);
    this._addLimb(root, 'GuardRightLeg', 0.17, 0.48, 0, uniform, 0.18, 0.82);

    return root;
  }

  _addLimb(root, name, x, y, z, material, width = 0.16, height = 0.72) {
    const limb = new THREE.Mesh(new THREE.BoxGeometry(width, height, width), material);
    limb.name = name;
    limb.position.set(x, y, z);
    limb.castShadow = true;
    root.add(limb);
  }

  _createFlashlight() {
    this.flashlight = new THREE.SpotLight(0xf4f0d0, 4.5, this.flashlightRange, this.flashlightFov, 0.55, 1.6);
    this.flashlight.name = 'GuardFlashlight';
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.position.set(0, EYE_HEIGHT, 0.2);
    this.mesh.add(this.flashlight);

    this.flashlightTarget = new THREE.Object3D();
    this.flashlightTarget.name = 'GuardFlashlightTarget';
    this.scene.add(this.flashlightTarget);
    this.flashlight.target = this.flashlightTarget;

    const bezel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.095, 0.18, 12),
      new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.45,
        metalness: 0.5,
        emissive: 0x352f18,
        emissiveIntensity: 0.5,
      }),
    );
    bezel.name = 'GuardFlashlightBezel';
    bezel.rotation.x = Math.PI / 2;
    bezel.position.set(0.18, 1.52, 0.22);
    bezel.castShadow = true;
    this.mesh.add(bezel);
  }
}

function toVector3(value) {
  if (value?.isVector3) return value;
  return new THREE.Vector3(value?.x ?? 0, value?.y ?? 0, value?.z ?? 0);
}

function getEntityPosition(entity, out) {
  if (!entity) return null;
  if (entity.position?.isVector3) return out.copy(entity.position);
  if (entity.mesh?.getWorldPosition) return entity.mesh.getWorldPosition(out);
  if (entity.object?.getWorldPosition) return entity.object.getWorldPosition(out);
  if (entity.camera?.getWorldPosition) return entity.camera.getWorldPosition(out);
  return null;
}
