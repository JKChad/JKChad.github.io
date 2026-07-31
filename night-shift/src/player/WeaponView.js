import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, damp, smoothstep } from '../utils/math.js';

const _baseMagPos = new THREE.Vector3(0.035, -0.145, -0.115);
const _baseSlidePos = new THREE.Vector3(0, 0.014, -0.03);
const _zeroVec2 = new THREE.Vector2();
const _zeroVec3 = new THREE.Vector3();

function box(w, h, d, material, position, rotation = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.fromArray(position);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
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
  mesh.receiveShadow = true;
  return mesh;
}

export class WeaponView {
  constructor(camera) {
    this.camera = camera;
    this.group = new THREE.Group();
    this.group.name = 'ProceduralWeapon';
    this.camera.add(this.group);

    this._metal = new THREE.MeshStandardMaterial({
      color: 0x171b20,
      roughness: 0.56,
      metalness: 0.75,
      envMapIntensity: 0.7,
    });
    this._edgeMetal = new THREE.MeshStandardMaterial({
      color: 0x2b333b,
      roughness: 0.42,
      metalness: 0.82,
      emissive: 0x05080a,
    });
    this._polymer = new THREE.MeshStandardMaterial({
      color: 0x0d1015,
      roughness: 0.82,
      metalness: 0.08,
    });
    this._rubber = new THREE.MeshStandardMaterial({
      color: 0x050607,
      roughness: 0.92,
      metalness: 0.02,
    });
    this._sightGlow = new THREE.MeshStandardMaterial({
      color: 0x7df4de,
      emissive: 0x31e6d0,
      emissiveIntensity: 1.9,
      roughness: 0.28,
      metalness: 0,
    });
    this._muzzleFlash = new THREE.MeshStandardMaterial({
      color: 0xffd08a,
      emissive: 0xff9b38,
      emissiveIntensity: 6,
      roughness: 0.2,
      metalness: 0,
      transparent: true,
      opacity: 0.96,
    });

    this.weapon = new THREE.Group();
    this.group.add(this.weapon);
    this._buildMesh();

    // Bring the SMG into the lower-right frustum so the silhouette reads in dim light.
    this._hipPos = new THREE.Vector3(0.22, -0.22, -0.48);
    this._adsPos = new THREE.Vector3(0.0, -0.145, -0.42);
    this._hipRot = new THREE.Euler(-0.035, 0.2, -0.025, 'XYZ');
    this._adsRot = new THREE.Euler(-0.012, 0.006, 0.0, 'XYZ');

    this._adsTarget = false;
    this._adsBlend = 0;
    this._time = 0;
    this._lookLag = new THREE.Vector2();
    this._bob = new THREE.Vector2();
    this._accelOffset = new THREE.Vector3();
    this._accelRot = new THREE.Vector3();
    this._recoilPos = new THREE.Vector3();
    this._recoilRot = new THREE.Vector3();
    this._recoilEvents = [];
    this._slideKick = 0;
    this._strafeRoll = 0;
  }

  setAds(active) {
    this._adsTarget = active;
  }

  punch(recoilStrength = CONFIG.weapon.recoilKick, options = {}) {
    const adsMul = options.ads ? 0.52 : 1;
    const meleeMul = options.melee ? 0.75 : 1;
    this._recoilEvents.push({
      t: 0,
      duration: options.melee ? 0.34 : 0.27,
      strength: recoilStrength * adsMul * meleeMul,
      yaw: (Math.random() - 0.5) * recoilStrength * 1.7 * adsMul,
      roll: (Math.random() - 0.5) * recoilStrength * 1.25 * adsMul,
    });
    if (this._recoilEvents.length > 8) this._recoilEvents.shift();
  }

  update(dt, state = {}) {
    const {
      grounded = true,
      ads = this._adsTarget,
      reloading = false,
      reloadT = 0,
      firing = false,
      lookVelocity = _zeroVec2,
      localVelocity = _zeroVec3,
      horizontalSpeed = 0,
      accel = 0,
      localAccel = _zeroVec3,
      moveState = 'idle',
      crouchAmount = 0,
    } = state;

    this._time += dt;
    this.setAds(ads);
    this._adsBlend = damp(this._adsBlend, this._adsTarget ? 1 : 0, 18, dt);

    const adsMul = 1 - this._adsBlend * 0.66;
    const speed01 = clamp(horizontalSpeed / CONFIG.player.runSpeed, 0, 1);
    const crouchMul = 1 - crouchAmount * 0.38;
    const moveAmp = grounded ? speed01 * crouchMul : 0;
    const idleBlend = moveState === 'idle' ? 1 : 0.22;
    const walkMul = moveState === 'walk' ? 0.72 : moveState === 'crouch' ? 0.42 : 1;

    const lookTargetX = clamp(-lookVelocity.x * 0.014, -0.045, 0.045) * adsMul;
    const lookTargetY = clamp(lookVelocity.y * 0.01, -0.032, 0.032) * adsMul;
    this._lookLag.x = damp(this._lookLag.x, lookTargetX, 9, dt);
    this._lookLag.y = damp(this._lookLag.y, lookTargetY, 9, dt);

    const lateral = localVelocity?.x ?? 0;
    const accelX = localAccel?.x ?? 0;
    const accelZ = localAccel?.z ?? 0;
    this._strafeRoll = damp(
      this._strafeRoll,
      clamp(-lateral * 0.022, -0.09, 0.09) * adsMul,
      11,
      dt,
    );

    this._accelOffset.x = damp(
      this._accelOffset.x,
      clamp(-accelX * 0.0007, -0.024, 0.024) * adsMul,
      17,
      dt,
    );
    this._accelOffset.y = damp(
      this._accelOffset.y,
      clamp(accel * 0.00024, 0, 0.012) * adsMul,
      12,
      dt,
    );
    this._accelOffset.z = damp(
      this._accelOffset.z,
      clamp(-accelZ * 0.00085, -0.028, 0.028) * adsMul,
      15,
      dt,
    );
    this._accelRot.x = damp(
      this._accelRot.x,
      clamp(accelZ * 0.0022, -0.075, 0.075) * adsMul,
      14,
      dt,
    );
    this._accelRot.z = damp(
      this._accelRot.z,
      clamp(-accelX * 0.0016, -0.045, 0.045) * adsMul,
      14,
      dt,
    );

    const bobFreq = CONFIG.weapon.swayFreq * (4.2 + speed01 * 2.5);
    const bobAmp = CONFIG.weapon.swayAmp * 1.65 * moveAmp * adsMul * walkMul;
    const bobX = Math.sin(this._time * bobFreq) * bobAmp;
    const bobY = Math.abs(Math.cos(this._time * bobFreq * 0.5)) * bobAmp * 0.58;
    this._bob.x = damp(this._bob.x, bobX, 10, dt);
    this._bob.y = damp(this._bob.y, bobY, 10, dt);

    const breath = Math.sin(this._time * 1.15)
      * CONFIG.weapon.swayAmp
      * 0.48
      * idleBlend
      * (0.6 + this._adsBlend * 0.75);
    this._updateRecoil(dt);

    this.group.position.lerpVectors(this._hipPos, this._adsPos, this._adsBlend);
    this.group.position.x += this._lookLag.x + this._bob.x + this._accelOffset.x + this._recoilPos.x;
    this.group.position.y += this._lookLag.y + this._bob.y + breath + this._accelOffset.y + this._recoilPos.y;
    this.group.position.z += this._accelOffset.z + this._recoilPos.z + crouchAmount * 0.018;

    this.group.rotation.x = this._lerpAngle(this._hipRot.x, this._adsRot.x, this._adsBlend)
      + this._recoilRot.x
      + this._lookLag.y * 0.28
      + this._accelRot.x
      + breath * 0.75
      + this._bob.y * 0.18;
    this.group.rotation.y = this._lerpAngle(this._hipRot.y, this._adsRot.y, this._adsBlend)
      + this._recoilRot.y
      - this._lookLag.x * 0.35
      + this._bob.x * 0.14;
    this.group.rotation.z = this._lerpAngle(this._hipRot.z, this._adsRot.z, this._adsBlend)
      + this._recoilRot.z
      + this._strafeRoll
      - this._lookLag.x * 0.16
      + this._accelRot.z
      - this._bob.x * 0.2;

    if (firing) {
      this.muzzleGlow.visible = true;
      this.muzzleGlow.scale.setScalar(0.75 + Math.random() * 0.9);
      this._muzzleFlash.emissiveIntensity = 7 + Math.random() * 5;
      this.muzzleLight.intensity = 2.2 + Math.random() * 2.4;
    } else {
      this.muzzleGlow.visible = false;
      this.muzzleLight.intensity = 0;
    }

    this._updateReload(reloading, reloadT);
  }

  _buildMesh() {
    this.receiver = box(0.25, 0.11, 0.42, this._metal, [0, 0, -0.12]);
    this.weapon.add(this.receiver);

    this.slide = box(0.235, 0.055, 0.36, this._edgeMetal, _baseSlidePos.toArray());
    this.weapon.add(this.slide);

    this.ejectionPort = box(0.076, 0.01, 0.072, this._rubber, [0.046, 0.048, -0.118]);
    this.weapon.add(this.ejectionPort);

    this.rail = box(0.17, 0.018, 0.31, this._rubber, [0, 0.072, -0.047]);
    this.weapon.add(this.rail);

    this.barrel = cyl(0.028, 0.028, 0.31, this._edgeMetal, [0, 0.004, -0.38], [Math.PI * 0.5, 0, 0], 20);
    this.weapon.add(this.barrel);

    this.muzzle = cyl(0.041, 0.047, 0.115, this._metal, [0, 0.004, -0.57], [Math.PI * 0.5, 0, 0], 20);
    this.weapon.add(this.muzzle);

    this.muzzleGlow = cyl(0.035, 0.001, 0.052, this._muzzleFlash, [0, 0.004, -0.655], [Math.PI * 0.5, 0, 0], 12);
    this.muzzleGlow.visible = false;
    this.weapon.add(this.muzzleGlow);
    this.muzzleLight = new THREE.PointLight(0xffba78, 0, 2.6, 2);
    this.muzzleLight.position.set(0, 0.025, -0.68);
    this.weapon.add(this.muzzleLight);

    this.grip = box(0.105, 0.25, 0.105, this._polymer, [0.018, -0.188, -0.02], [0.32, 0, 0.03]);
    this.weapon.add(this.grip);

    this.mag = box(0.095, 0.21, 0.105, this._rubber, _baseMagPos.toArray(), [0.16, 0, 0.015]);
    this.weapon.add(this.mag);

    this.triggerGuard = cyl(0.034, 0.034, 0.018, this._polymer, [0, -0.08, -0.15], [Math.PI * 0.5, 0, 0], 14);
    this.triggerGuard.scale.set(1.35, 0.62, 1);
    this.weapon.add(this.triggerGuard);

    this.stock = box(0.135, 0.095, 0.28, this._polymer, [0, -0.02, 0.2], [-0.08, 0, 0]);
    this.weapon.add(this.stock);

    this.frontGrip = box(0.065, 0.16, 0.07, this._polymer, [0, -0.145, -0.29], [-0.2, 0, 0]);
    this.weapon.add(this.frontGrip);

    this.rearSight = box(0.105, 0.032, 0.035, this._rubber, [0, 0.105, 0.095]);
    this.weapon.add(this.rearSight);

    this.frontSight = box(0.075, 0.036, 0.026, this._rubber, [0, 0.101, -0.35]);
    this.weapon.add(this.frontSight);

    this.sightPip = cyl(0.009, 0.009, 0.006, this._sightGlow, [0, 0.128, -0.362], [Math.PI * 0.5, 0, 0], 10);
    this.weapon.add(this.sightPip);

    this.sideLight = box(0.012, 0.018, 0.09, this._sightGlow, [-0.126, 0.012, -0.185]);
    this.weapon.add(this.sideLight);
  }

  _updateReload(reloading, reloadT) {
    if (!reloading) {
      this.mag.position.copy(_baseMagPos);
      this.mag.rotation.set(0.16, 0, 0.015);
      this.mag.visible = true;
      this.slide.position.copy(_baseSlidePos);
      this.slide.position.z += this._slideKick;
      this.weapon.rotation.set(0, 0, 0);
      this.weapon.position.set(0, 0, 0);
      return;
    }

    const t = Math.min(Math.max(reloadT, 0), 1);
    const lower = smoothstep(0.02, 0.16, t) * (1 - smoothstep(0.88, 1, t));
    const out = smoothstep(0.16, 0.32, t);
    const insert = smoothstep(0.52, 0.68, t);
    const seat = Math.sin(smoothstep(0.68, 0.78, t) * Math.PI);
    const rack = smoothstep(0.78, 0.84, t) - smoothstep(0.84, 0.93, t);
    const settle = smoothstep(0.88, 1, t);

    if (t < 0.36) {
      this.mag.visible = true;
      this.mag.position.set(
        _baseMagPos.x - out * 0.055,
        _baseMagPos.y - lower * 0.1 - out * 0.26,
        _baseMagPos.z + out * 0.085,
      );
      this.mag.rotation.set(0.16 + out * 0.68, out * -0.32, 0.015 - out * 0.22);
    } else if (t < 0.52) {
      this.mag.visible = false;
    } else {
      this.mag.visible = true;
      this.mag.position.set(
        _baseMagPos.x + (1 - insert) * 0.15,
        _baseMagPos.y - (1 - insert) * 0.34 - seat * 0.016,
        _baseMagPos.z + (1 - insert) * 0.09,
      );
      this.mag.rotation.set(0.16 + (1 - insert) * -0.25, (1 - insert) * 0.28, 0.015 + seat * 0.035);
    }

    this.slide.position.copy(_baseSlidePos);
    this.slide.position.z += rack * 0.09 + this._slideKick;
    this.slide.position.y += rack * 0.006;

    this.weapon.position.y = -lower * 0.055 + seat * 0.018 + rack * 0.01;
    this.weapon.position.z = lower * 0.035 - settle * 0.035;
    this.weapon.rotation.x = -lower * 0.2 + seat * 0.055 + rack * 0.04;
    this.weapon.rotation.y = -lower * 0.075 + Math.sin(t * Math.PI * 1.4) * 0.026;
    this.weapon.rotation.z = lower * 0.12 - seat * 0.065 - settle * 0.12;
  }

  _updateRecoil(dt) {
    this._recoilPos.set(0, 0, 0);
    this._recoilRot.set(0, 0, 0);
    this._slideKick = 0;

    for (let i = this._recoilEvents.length - 1; i >= 0; i -= 1) {
      const event = this._recoilEvents[i];
      event.t += dt;
      const t = clamp(event.t / event.duration, 0, 1);
      const snap = 1 - smoothstep(0.1, 0.62, t);
      const slide = Math.sin(smoothstep(0.08, 0.36, t) * Math.PI);
      const overshoot = Math.sin(smoothstep(0.68, 1, t) * Math.PI);
      const strength = event.strength;

      this._recoilPos.z += strength * (1.75 * snap + 0.5 * slide - 0.16 * overshoot);
      this._recoilPos.y += strength * (0.34 * snap - 0.11 * overshoot);
      this._recoilRot.x -= strength * (3.45 * snap + 0.8 * slide - 0.48 * overshoot);
      this._recoilRot.y += event.yaw * (snap + slide * 0.45);
      this._recoilRot.z += event.roll * (snap + slide * 0.3);
      this._slideKick += strength * 2.25 * slide;

      if (event.t >= event.duration) this._recoilEvents.splice(i, 1);
    }
  }

  _lerpAngle(a, b, t) {
    return a + (b - a) * t;
  }
}
