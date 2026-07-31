import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { damp, smoothstep } from '../utils/math.js';

const _baseMagPos = new THREE.Vector3(0.035, -0.145, -0.115);
const _baseSlidePos = new THREE.Vector3(0, 0.014, -0.03);

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

    this.weapon = new THREE.Group();
    this.group.add(this.weapon);
    this._buildMesh();

    this._hipPos = new THREE.Vector3(0.34, -0.31, -0.64);
    this._adsPos = new THREE.Vector3(0.006, -0.175, -0.54);
    this._hipRot = new THREE.Euler(-0.035, 0.2, -0.025, 'XYZ');
    this._adsRot = new THREE.Euler(-0.012, 0.006, 0.0, 'XYZ');

    this._adsTarget = false;
    this._adsBlend = 0;
    this._time = 0;
    this._swayX = 0;
    this._swayY = 0;
    this._kickPos = new THREE.Vector3();
    this._kickRot = new THREE.Vector3();
  }

  setAds(active) {
    this._adsTarget = active;
  }

  punch(recoilStrength = CONFIG.weapon.recoilKick) {
    const kick = recoilStrength * 12;
    this._kickPos.z += kick * 0.13;
    this._kickPos.y += kick * 0.035;
    this._kickRot.x -= kick * 0.26;
    this._kickRot.y += (Math.random() - 0.5) * kick * 0.08;
    this._kickRot.z += (Math.random() - 0.5) * kick * 0.06;
  }

  update(dt, state = {}) {
    const {
      moving = false,
      grounded = true,
      ads = this._adsTarget,
      reloading = false,
      reloadT = 0,
      firing = false,
    } = state;

    this._time += dt;
    this.setAds(ads);
    this._adsBlend = damp(this._adsBlend, this._adsTarget ? 1 : 0, 18, dt);

    const moveAmp = moving && grounded ? 1 : 0.22;
    const adsMul = 1 - this._adsBlend * 0.72;
    const swayAmp = CONFIG.weapon.swayAmp * 4.2 * moveAmp * adsMul;
    const swayFreq = CONFIG.weapon.swayFreq * (moving ? 5.2 : 1.65);
    const bobX = Math.sin(this._time * swayFreq) * swayAmp;
    const bobY = Math.abs(Math.cos(this._time * swayFreq * 0.5)) * swayAmp * 0.64;
    this._swayX = damp(this._swayX, bobX, 10, dt);
    this._swayY = damp(this._swayY, bobY, 10, dt);

    this._kickPos.multiplyScalar(Math.exp(-CONFIG.weapon.recoilRecovery * dt));
    this._kickRot.multiplyScalar(Math.exp(-CONFIG.weapon.recoilRecovery * 1.15 * dt));

    this.group.position.lerpVectors(this._hipPos, this._adsPos, this._adsBlend);
    this.group.position.x += this._swayX + this._kickPos.x;
    this.group.position.y += this._swayY + this._kickPos.y;
    this.group.position.z += this._kickPos.z;

    this.group.rotation.x = this._lerpAngle(this._hipRot.x, this._adsRot.x, this._adsBlend)
      + this._kickRot.x
      + this._swayY * 0.12;
    this.group.rotation.y = this._lerpAngle(this._hipRot.y, this._adsRot.y, this._adsBlend)
      + this._kickRot.y
      + this._swayX * 0.09;
    this.group.rotation.z = this._lerpAngle(this._hipRot.z, this._adsRot.z, this._adsBlend)
      + this._kickRot.z
      - this._swayX * 0.11;

    if (firing) {
      this.muzzleGlow.visible = true;
      this.muzzleGlow.scale.setScalar(0.6 + Math.random() * 0.6);
    } else {
      this.muzzleGlow.visible = false;
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

    this.muzzleGlow = cyl(0.025, 0.001, 0.035, this._sightGlow, [0, 0.004, -0.642], [Math.PI * 0.5, 0, 0], 12);
    this.muzzleGlow.visible = false;
    this.weapon.add(this.muzzleGlow);

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
      this.weapon.rotation.set(0, 0, 0);
      return;
    }

    const t = Math.min(Math.max(reloadT, 0), 1);
    const pull = smoothstep(0.05, 0.25, t);
    const out = smoothstep(0.24, 0.44, t);
    const insert = smoothstep(0.48, 0.72, t);
    const seat = smoothstep(0.72, 0.84, t);
    const rack = Math.sin(smoothstep(0.76, 0.96, t) * Math.PI);

    if (t < 0.48) {
      this.mag.visible = true;
      this.mag.position.set(
        _baseMagPos.x - out * 0.035,
        _baseMagPos.y - pull * 0.18 - out * 0.1,
        _baseMagPos.z + out * 0.065,
      );
      this.mag.rotation.set(0.16 + pull * 0.55, out * -0.25, 0.015 - out * 0.18);
    } else {
      this.mag.visible = true;
      this.mag.position.set(
        _baseMagPos.x + (1 - insert) * 0.08,
        _baseMagPos.y - (1 - insert) * 0.28 + seat * 0.018,
        _baseMagPos.z + (1 - insert) * 0.045,
      );
      this.mag.rotation.set(0.16 + (1 - insert) * -0.18, (1 - insert) * 0.2, 0.015);
    }

    this.slide.position.copy(_baseSlidePos);
    this.slide.position.z += rack * 0.075;
    this.slide.position.y += rack * 0.006;

    this.weapon.rotation.x = -Math.sin(t * Math.PI) * 0.12;
    this.weapon.rotation.y = -Math.sin(t * Math.PI * 1.4) * 0.055;
    this.weapon.rotation.z = Math.sin(t * Math.PI) * 0.085;
  }

  _lerpAngle(a, b, t) {
    return a + (b - a) * t;
  }
}
