import * as THREE from 'three';

const _playerPos = new THREE.Vector3();
const _safeRoom = new THREE.Vector3();

function vectorFrom(value, fallback, out) {
  if (value?.isVector3) return out.copy(value);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return out.set(value.x, value.y, value.z);
  }
  return out.copy(fallback);
}

function playerPosition(player, out) {
  if (player?.position?.isVector3) return out.copy(player.position);
  if (player?.camera?.getWorldPosition) return player.camera.getWorldPosition(out);
  if (player?.object?.getWorldPosition) return player.object.getWorldPosition(out);
  return out.set(0, 0, 0);
}

export class RegroupDirector {
  constructor(scene, bus, options = {}) {
    this.scene = scene;
    this.bus = bus;
    this.safeRoom = vectorFrom(options.safeRoom, new THREE.Vector3(-10.8, 0, 8.1), _safeRoom).clone();
    this.reachRadius = options.reachRadius ?? 2.1;
    this.cooldownSeconds = options.cooldownSeconds ?? 14;
    this.state = 'idle';
    this.reason = null;
    this.cooldown = 0;
    this.marker = this._createMarker();
    this._pulse = 0;
  }

  get active() {
    return this.state === 'regroup';
  }

  update(dt, context = {}) {
    this._updateMarker(dt);

    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (context.mode !== 'loud') {
      this._setIdle();
      return this.state;
    }

    if (this.state !== 'regroup' && this.cooldown <= 0) {
      const hp = Number.isFinite(context.playerHealth) ? context.playerHealth : 100;
      if (hp > 0 && hp < 40) this.start('low-health');
      else if (context.allMagsEmpty === true) this.start('empty-mags');
    }

    if (this.state !== 'regroup') return this.state;

    playerPosition(context.player, _playerPos);
    _playerPos.y = 0;
    const distance = _playerPos.distanceTo(this.safeRoom);
    this.bus?.emit?.('regroup:updated', {
      safeRoom: this.safeRoom.clone(),
      distance,
      reason: this.reason,
    });

    if (distance <= this.reachRadius) this.complete();
    return this.state;
  }

  start(reason = 'pressure') {
    if (this.state === 'regroup') return;
    this.state = 'regroup';
    this.reason = reason;
    this.marker.visible = true;
    this.bus?.emit?.('regroup:started', {
      safeRoom: this.safeRoom.clone(),
      reason,
    });
  }

  complete() {
    if (this.state !== 'regroup') return;
    const reason = this.reason;
    this.state = 'cooldown';
    this.reason = null;
    this.cooldown = this.cooldownSeconds;
    this.marker.visible = false;
    this.bus?.emit?.('regroup:reached', {
      safeRoom: this.safeRoom.clone(),
      reason,
      ammoFill: 0.5,
      pressureReliefSeconds: 4.5,
      minHealth: 62,
    });
  }

  _setIdle() {
    if (this.state === 'idle') return;
    this.state = 'idle';
    this.reason = null;
    this.marker.visible = false;
  }

  _createMarker() {
    const group = new THREE.Group();
    group.name = 'regroup-safe-room-marker';
    group.position.copy(this.safeRoom);
    group.visible = false;
    group.userData.isCombatVfx = true;
    group.userData.combatIgnore = true;

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xe8a84a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(this.reachRadius, 0.035, 8, 64), ringMaterial);
    ring.name = 'regroup-radius-ring';
    ring.rotation.x = Math.PI / 2;
    ring.userData.isCombatVfx = true;
    ring.userData.combatIgnore = true;
    group.add(ring);

    const beaconMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.7, 2.6, 24, 1, true), beaconMaterial);
    beacon.name = 'regroup-beacon';
    beacon.position.y = 1.3;
    beacon.userData.isCombatVfx = true;
    beacon.userData.combatIgnore = true;
    group.add(beacon);

    this.scene?.add?.(group);
    return group;
  }

  _updateMarker(dt) {
    if (!this.marker?.visible) return;
    this._pulse += dt;
    this.marker.rotation.y += dt * 0.9;
    const pulse = 0.5 + 0.5 * Math.sin(this._pulse * 5.2);
    for (const child of this.marker.children) {
      if (child.material) child.material.opacity = child.name.includes('beacon') ? 0.18 + pulse * 0.2 : 0.42 + pulse * 0.18;
    }
  }
}
