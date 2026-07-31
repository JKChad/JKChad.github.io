import * as THREE from 'three';
import { CONFIG, KEYS } from '../config.js';
import { clamp, damp } from '../utils/math.js';
import { GADGET_ORDER, WEAPON_ORDER, getGadgetDef, getWeaponDef } from '../core/combat/Loadout.js';
import { gadgetCatalogEntry, initialAmmoState, initialGadgetCharges, weaponCatalogEntry } from '../combat/WeaponCatalog.js';
import { WeaponView } from './WeaponView.js';

const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();

export class WeaponSystem {
  constructor(player, bus, audio) {
    this.player = player;
    this.bus = bus;
    this.audio = audio;

    this.view = new WeaponView(this.player.camera);
    this.weaponIds = [...WEAPON_ORDER];
    this.gadgetIds = [...GADGET_ORDER];
    this.currentWeaponIndex = 0;
    this.currentGadgetIndex = 0;
    this.currentWeaponId = this.weaponIds[this.currentWeaponIndex];
    this.currentGadgetId = this.gadgetIds[this.currentGadgetIndex];
    this.ammoByWeapon = initialAmmoState();
    this.gadgetCharges = initialGadgetCharges();
    this.weapon = getWeaponDef(this.currentWeaponId);
    this.gadget = getGadgetDef(this.currentGadgetId);
    this.mag = this.ammoByWeapon[this.currentWeaponId].mag;
    this.reserve = this.ammoByWeapon[this.currentWeaponId].reserve;
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
    this._onResupply = (payload) => this._resupply(payload);

    const doc = this.player.domElement?.ownerDocument ?? document;
    doc.addEventListener('mousedown', this._onMouseDown);
    doc.addEventListener('mouseup', this._onMouseUp);
    doc.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('keydown', this._onKeyDown);
    this.bus.on?.('weapon:resupply', this._onResupply);

    this._emitAmmo();
    this._emitWeapon();
    this._emitGadget();
  }

  update(dt) {
    const safeDt = Math.min(dt, CONFIG.maxFrameDt);
    this._fireCooldown = Math.max(0, this._fireCooldown - safeDt);
    this._shotFlashT = Math.max(0, this._shotFlashT - safeDt);
    this._meleeCooldown = Math.max(0, this._meleeCooldown - safeDt);

    if (this.reloading) this._updateReload(safeDt);
    this._updateFov(safeDt);

    if (this._triggerHeld && this.weapon.fireMode === 'auto') {
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
    } else if (event.code === 'KeyC' || event.code === 'BracketRight') {
      this._selectWeapon(this.currentWeaponIndex + 1);
    } else if (event.code === 'BracketLeft' || event.code === 'KeyV') {
      this._selectWeapon(this.currentWeaponIndex - 1);
    } else if (event.code === 'KeyX') {
      this._selectGadget(this.currentGadgetIndex + 1);
    } else if (event.code === 'KeyG') {
      this._useGadget();
    }
  }

  _tryFire() {
    if (this.reloading || this._fireCooldown > 0) return;

    if (this.mag <= 0) {
      this._beginReload();
      return;
    }

    this.mag -= 1;
    this._storeCurrentAmmo();
    this._fireCooldown = 1 / this.weapon.fireRate;
    this._shotFlashT = 0.045;

    this._buildShotRay(_origin, _direction);
    const damage = this.isAds && this.weapon.adsDamage ? this.weapon.adsDamage : this.weapon.damage;
    this.bus.emit('weapon:fired', {
      origin: _origin.clone(),
      direction: _direction.clone(),
      spread: this.isAds ? this.weapon.spreadAds : this.weapon.spreadHip,
      damage,
      ads: this.isAds,
      weaponId: this.currentWeaponId,
      weapon: weaponCatalogEntry(this.currentWeaponId),
      pellets: this.weapon.pellets ?? 1,
      maxDistance: this.weapon.maxDistance,
      attentionSpike: this.weapon.shotAttention,
    });

    this.audio?.play('shot');
    this.view.punch(this.weapon.recoilKick, { ads: this.isAds });
    if (this.player.addRecoil) {
      const hipMul = this.isAds ? 0.48 : 1;
      const yawKick = (Math.random() - 0.5) * this.weapon.recoilKick * 0.36 * hipMul;
      this.player.addRecoil(this.weapon.recoilKick * 0.82 * hipMul, yawKick);
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
    if (this.reloading || this.mag >= this.weapon.magSize || this.reserve <= 0) return;

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
    this.reloadT = clamp(this._reloadElapsed / this.weapon.reloadTime, 0, 1);
    this._emitReloadPhaseForT(this.reloadT);

    if (this.reloadT < 1) return;

    const needed = this.weapon.magSize - this.mag;
    const loaded = Math.min(needed, this.reserve);
    this.mag += loaded;
    this.reserve -= loaded;
    this._storeCurrentAmmo();
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
      damage: Math.round(this.weapon.damage * 0.8),
      range: 1.6,
      weaponId: this.currentWeaponId,
      melee: true,
    });

    this.audio?.play('melee');
    this.view.punch(this.weapon.recoilKick * 0.6, { melee: true });
  }

  _updateFov(dt) {
    const target = this.isAds ? this.weapon.adsFov : this.weapon.hipFov;
    const next = damp(this.player.camera.fov, target, this.isAds ? 18 : 13, dt);
    if (Math.abs(next - this.player.camera.fov) > 0.01) {
      this.player.camera.fov = next;
      this.player.camera.updateProjectionMatrix();
    }
  }

  _emitAmmo() {
    const allAmmoEmpty = this._allAmmoEmpty();
    const payload = {
      weaponId: this.currentWeaponId,
      weapon: weaponCatalogEntry(this.currentWeaponId),
      mag: this.mag,
      reserve: this.reserve,
      allAmmoEmpty,
      allMagsEmpty: allAmmoEmpty,
      inventory: this._ammoSnapshot(),
    };
    this.bus.emit('weapon:ammo', payload);
    this.bus.emit('weapon:inventory', payload);
  }

  _emitWeapon() {
    this.bus.emit('weapon:selected', {
      weaponId: this.currentWeaponId,
      weapon: weaponCatalogEntry(this.currentWeaponId),
      index: this.currentWeaponIndex,
    });
  }

  _emitGadget() {
    this.bus.emit('gadget:selected', {
      gadgetId: this.currentGadgetId,
      gadget: gadgetCatalogEntry(this.currentGadgetId),
      charges: this.gadgetCharges[this.currentGadgetId] ?? 0,
      index: this.currentGadgetIndex,
    });
  }

  _selectWeapon(index) {
    const count = this.weaponIds.length;
    const nextIndex = ((index % count) + count) % count;
    if (nextIndex === this.currentWeaponIndex) return;

    this._storeCurrentAmmo();
    this.currentWeaponIndex = nextIndex;
    this.currentWeaponId = this.weaponIds[nextIndex];
    this.weapon = getWeaponDef(this.currentWeaponId);
    const ammo = this.ammoByWeapon[this.currentWeaponId];
    this.mag = ammo.mag;
    this.reserve = ammo.reserve;
    this.reloading = false;
    this.reloadT = 0;
    this._reloadElapsed = 0;
    this._reloadPhase = null;
    this._triggerHeld = false;
    this._setAds(false);
    this._fireCooldown = Math.min(this._fireCooldown, 0.18);
    this.audio?.play?.('reload');
    this._emitWeapon();
    this._emitAmmo();
  }

  _selectGadget(index) {
    const count = this.gadgetIds.length;
    this.currentGadgetIndex = ((index % count) + count) % count;
    this.currentGadgetId = this.gadgetIds[this.currentGadgetIndex];
    this.gadget = getGadgetDef(this.currentGadgetId);
    this._emitGadget();
  }

  _useGadget() {
    const charges = this.gadgetCharges[this.currentGadgetId] ?? 0;
    if (charges <= 0) {
      this.bus.emit('gadget:empty', {
        gadgetId: this.currentGadgetId,
        gadget: gadgetCatalogEntry(this.currentGadgetId),
      });
      return;
    }

    this.gadgetCharges[this.currentGadgetId] = charges - 1;
    this._buildShotRay(_origin, _direction);
    this.bus.emit('gadget:used', {
      gadgetId: this.currentGadgetId,
      gadget: gadgetCatalogEntry(this.currentGadgetId),
      origin: _origin.clone(),
      direction: _direction.clone(),
      charges: this.gadgetCharges[this.currentGadgetId],
    });
    this._emitGadget();
  }

  _storeCurrentAmmo() {
    this.ammoByWeapon[this.currentWeaponId] = {
      mag: this.mag,
      reserve: this.reserve,
    };
  }

  _ammoSnapshot() {
    this._storeCurrentAmmo();
    return Object.fromEntries(
      Object.entries(this.ammoByWeapon).map(([id, ammo]) => [id, { ...ammo }])
    );
  }

  _allAmmoEmpty() {
    this._storeCurrentAmmo();
    return Object.entries(this.ammoByWeapon).every(([id, ammo]) => {
      const weapon = getWeaponDef(id);
      return (ammo.mag ?? 0) <= 0 && (ammo.reserve ?? 0) <= 0 && weapon.magSize > 0;
    });
  }

  _resupply(payload = {}) {
    const fill = clamp(payload.ammoFill ?? 0.5, 0, 1);
    this._storeCurrentAmmo();
    for (const id of this.weaponIds) {
      const weapon = getWeaponDef(id);
      const ammo = this.ammoByWeapon[id];
      ammo.mag = Math.max(ammo.mag, Math.ceil(weapon.magSize * fill));
      ammo.reserve = Math.max(ammo.reserve, Math.ceil(weapon.reserve * fill));
    }
    const current = this.ammoByWeapon[this.currentWeaponId];
    this.mag = current.mag;
    this.reserve = current.reserve;
    this.reloading = false;
    this.reloadT = 0;
    this._emitAmmo();
  }
}
