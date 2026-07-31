import * as THREE from 'three';
import { CONFIG, KEYS } from '../config.js';
import { clamp, damp } from '../utils/math.js';
import { WeaponView } from './WeaponView.js';

const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();

export class WeaponSystem {
  constructor(player, bus, audio) {
    this.player = player;
    this.bus = bus;
    this.audio = audio;

    this.view = new WeaponView(this.player.camera);
    this.mag = CONFIG.weapon.magSize;
    this.reserve = CONFIG.weapon.reserve;
    this.isAds = false;
    this.reloading = false;
    this.reloadT = 0;

    this._triggerHeld = false;
    this._fireCooldown = 0;
    this._reloadElapsed = 0;
    this._reloadPhase = null;
    this._shotFlashT = 0;
    this._meleeCooldown = 0;

    this._onMouseDown = (event) => this._handleMouseDown(event);
    this._onMouseUp = (event) => this._handleMouseUp(event);
    this._onContextMenu = (event) => event.preventDefault();
    this._onKeyDown = (event) => this._handleKeyDown(event);

    const doc = this.player.domElement?.ownerDocument ?? document;
    doc.addEventListener('mousedown', this._onMouseDown);
    doc.addEventListener('mouseup', this._onMouseUp);
    doc.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('keydown', this._onKeyDown);

    this._emitAmmo();
  }

  update(dt) {
    const safeDt = Math.min(dt, CONFIG.maxFrameDt);
    this._fireCooldown = Math.max(0, this._fireCooldown - safeDt);
    this._shotFlashT = Math.max(0, this._shotFlashT - safeDt);
    this._meleeCooldown = Math.max(0, this._meleeCooldown - safeDt);

    if (this.reloading) this._updateReload(safeDt);
    this._updateFov(safeDt);

    if (this._triggerHeld) {
      this._tryFire();
    }

    this.player.isAds = this.isAds;
    this.view.update(safeDt, {
      moving: this.player.isMoving,
      grounded: this.player.isGrounded,
      ads: this.isAds,
      reloading: this.reloading,
      reloadT: this.reloadT,
      firing: this._shotFlashT > 0,
      lookVelocity: this.player.lookVelocity,
      velocity: this.player.velocity,
      localVelocity: this.player.localVelocity,
      horizontalSpeed: this.player.horizontalSpeed,
      accel: this.player.accel,
      accelVector: this.player.accelVector,
      localAccel: this.player.localAccel,
      moveState: this.player.moveState,
      crouchAmount: this.player.crouchAmount,
    });
  }

  _handleMouseDown(event) {
    if (event.button === 0) {
      this._triggerHeld = true;
      this._tryFire();
    } else if (event.button === 2) {
      this._setAds(true);
    }
  }

  _handleMouseUp(event) {
    if (event.button === 0) {
      this._triggerHeld = false;
    } else if (event.button === 2) {
      this._setAds(false);
    }
  }

  _handleKeyDown(event) {
    if (event.repeat) return;

    if (event.code === KEYS.reload) {
      this._beginReload();
    } else if (event.code === KEYS.melee) {
      this._melee();
    }
  }

  _tryFire() {
    if (this.reloading || this._fireCooldown > 0) return;

    if (this.mag <= 0) {
      this._beginReload();
      return;
    }

    this.mag -= 1;
    this._fireCooldown = 1 / CONFIG.weapon.fireRate;
    this._shotFlashT = 0.045;

    this._buildShotRay(_origin, _direction);
    this.bus.emit('weapon:fired', {
      origin: _origin.clone(),
      direction: _direction.clone(),
      spread: this.isAds ? CONFIG.weapon.pelletSpreadAds : CONFIG.weapon.pelletSpreadHip,
      damage: CONFIG.weapon.damage,
      ads: this.isAds,
    });

    this.audio?.play('shot');
    this.view.punch(CONFIG.weapon.recoilKick, { ads: this.isAds });
    if (this.player.addRecoil) {
      const hipMul = this.isAds ? 0.48 : 1;
      const yawKick = (Math.random() - 0.5) * CONFIG.weapon.recoilKick * 0.36 * hipMul;
      this.player.addRecoil(CONFIG.weapon.recoilKick * 0.82 * hipMul, yawKick);
    }

    this._emitAmmo();
  }

  _buildShotRay(origin, direction) {
    this.player.camera.getWorldPosition(origin);
    this.player.camera.getWorldDirection(direction);
    return direction;
  }

  _setAds(active) {
    const next = Boolean(active) && !this.reloading;
    if (next === this.isAds) return;

    this.isAds = next;
    this.player.isAds = next;
    this.view.setAds(next);
    this.bus.emit('weapon:ads', next);
  }

  _beginReload() {
    if (this.reloading || this.mag >= CONFIG.weapon.magSize || this.reserve <= 0) return;

    this.reloading = true;
    this.reloadT = 0;
    this._reloadElapsed = 0;
    this._reloadPhase = null;
    this._triggerHeld = false;
    this._setAds(false);
    this.audio?.play('reload');
  }

  _updateReload(dt) {
    this._reloadElapsed += dt;
    this.reloadT = clamp(this._reloadElapsed / CONFIG.weapon.reloadTime, 0, 1);
    this._emitReloadPhaseForT(this.reloadT);

    if (this.reloadT < 1) return;

    const needed = CONFIG.weapon.magSize - this.mag;
    const loaded = Math.min(needed, this.reserve);
    this.mag += loaded;
    this.reserve -= loaded;
    this.reloading = false;
    this.reloadT = 0;
    this._emitReloadPhase('complete');
    this._emitAmmo();
  }

  _emitReloadPhaseForT(t) {
    if (t >= 0.78) {
      this._emitReloadPhase('rack');
    } else if (t >= 0.52) {
      this._emitReloadPhase('magIn');
    } else if (t >= 0.24) {
      this._emitReloadPhase('magOut');
    }
  }

  _emitReloadPhase(phase) {
    if (phase === this._reloadPhase) return;
    this._reloadPhase = phase;
    this.bus.emit('reload:phase', { phase });
  }

  _melee() {
    if (this._meleeCooldown > 0) return;

    this._meleeCooldown = 0.62;
    this._buildShotRay(_origin, _direction);
    this.bus.emit('weapon:melee', {
      origin: _origin.clone(),
      direction: _direction.clone(),
      damage: Math.round(CONFIG.weapon.damage * 0.8),
      range: 1.6,
    });

    this.audio?.play('melee');
    this.view.punch(CONFIG.weapon.recoilKick * 0.6, { melee: true });
  }

  _updateFov(dt) {
    const target = this.isAds ? CONFIG.weapon.adsFov : CONFIG.weapon.hipFov;
    const next = damp(this.player.camera.fov, target, this.isAds ? 18 : 13, dt);
    if (Math.abs(next - this.player.camera.fov) > 0.01) {
      this.player.camera.fov = next;
      this.player.camera.updateProjectionMatrix();
    }
  }

  _emitAmmo() {
    this.bus.emit('weapon:ammo', { mag: this.mag, reserve: this.reserve });
  }
}
