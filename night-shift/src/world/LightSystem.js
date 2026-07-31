import * as THREE from 'three';
import { CONFIG } from '../config.js';

const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
const _tmpC = new THREE.Vector3();

export class LightSystem {
  constructor(scene, bus, room) {
    this.scene = scene;
    this.bus = bus;
    this.room = room;
    this.group = new THREE.Group();
    this.group.name = 'light is the map';
    this.list = [];
    this._time = 0;
    this._raycaster = new THREE.Raycaster();
    this._occluders = room?.occluders ?? [];

    scene.add(this.group);

    this.ambient = new THREE.AmbientLight(0x111922, 0.032);
    scene.add(this.ambient);

    this._buildCeilingFixtures();
    this._buildDeskLamp();
    this._buildServerGlow();
  }

  _material(color, opacity) {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  _bulbMaterial(color, intensity) {
    return new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color),
      emissiveIntensity: intensity,
      metalness: 0.05,
      roughness: 0.28,
    });
  }

  _buildCeilingFixtures() {
    const h = CONFIG.room.height;
    const fixtures = [
      {
        id: 'north-west-ceiling',
        position: new THREE.Vector3(-7.9, h - 0.18, -6.3),
        target: new THREE.Vector3(-6.7, 0.04, -4.9),
        color: 0xaec5d5,
        sample: 0.58,
        lightIntensity: 15.5,
        range: 8.5,
        radius: 3.05,
        damaged: false,
        shadows: true,
      },
      {
        id: 'north-east-ceiling',
        position: new THREE.Vector3(6.5, h - 0.18, -6.1),
        target: new THREE.Vector3(5.6, 0.04, -4.6),
        color: 0xa9c2d6,
        sample: 0.54,
        lightIntensity: 14.25,
        range: 8.2,
        radius: 2.9,
        damaged: true,
        shadows: false,
      },
      {
        id: 'center-security-ceiling',
        position: new THREE.Vector3(-1.1, h - 0.2, -0.35),
        target: new THREE.Vector3(-1.9, 0.04, -0.1),
        color: 0xc4c1b2,
        sample: 0.72,
        lightIntensity: 18.5,
        range: 9.4,
        radius: 3.5,
        damaged: false,
        shadows: true,
      },
      {
        id: 'server-aisle-ceiling',
        position: new THREE.Vector3(7.8, h - 0.18, 2.9),
        target: new THREE.Vector3(6.4, 0.04, 3.2),
        color: 0x9dbbd0,
        sample: 0.48,
        lightIntensity: 12.5,
        range: 7.4,
        radius: 2.7,
        damaged: true,
        shadows: false,
      },
      {
        id: 'door-emergency-ceiling',
        position: new THREE.Vector3(0.2, h - 0.22, 8.2),
        target: new THREE.Vector3(0.1, 0.04, 7.0),
        color: 0xff9b39,
        sample: 0.42,
        lightIntensity: 10.75,
        range: 7.1,
        radius: 2.65,
        damaged: false,
        shadows: true,
      },
    ];

    for (const fixture of fixtures) this._createCeilingFixture(fixture);
  }

  _createCeilingFixture({
    id,
    position,
    target,
    color,
    sample,
    lightIntensity,
    range,
    radius,
    damaged,
    shadows,
  }) {
    const hardware = new THREE.Mesh(
      new THREE.BoxGeometry(1.25, 0.08, 0.34),
      new THREE.MeshStandardMaterial({
        color: 0x20262a,
        metalness: 0.72,
        roughness: 0.52,
        envMapIntensity: 0.28,
      })
    );
    hardware.name = `${id} oxidized ceiling fixture`;
    hardware.position.copy(position).add(new THREE.Vector3(0, 0.055, 0));
    hardware.castShadow = true;
    hardware.receiveShadow = true;
    this.group.add(hardware);

    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10), this._bulbMaterial(color, 1.4));
    bulb.name = `${id} breakable bulb`;
    bulb.position.copy(position);
    bulb.userData.breakableLight = true;
    bulb.userData.lightId = id;
    bulb.castShadow = false;
    this.group.add(bulb);

    const light = new THREE.SpotLight(color, lightIntensity, range, Math.PI / 4.8, 0.78, 2);
    light.name = `${id} real spot light`;
    light.position.copy(position);
    light.target.position.copy(target);
    light.castShadow = shadows;
    if (shadows) {
      light.shadow.mapSize.set(768, 768);
      light.shadow.bias = -0.00018;
      light.shadow.normalBias = 0.018;
      light.shadow.camera.near = 0.4;
      light.shadow.camera.far = range + 2;
    }
    this.group.add(light);
    this.group.add(light.target);

    const pool = this._createCeilingPool(id, position, target, color, radius);
    this.group.add(pool);

    this.list.push({
      id,
      position: position.clone(),
      intensity: sample,
      range,
      alive: true,
      light,
      pool,
      bulb,
      damaged,
      _baseLightIntensity: lightIntensity,
      _baseEmissiveIntensity: 1.4,
      _basePoolOpacity: 0.082,
      _phase: Math.random() * Math.PI * 2,
      _poolMaterials: pool.userData.materials,
    });
  }

  _createCeilingPool(id, position, target, color, radius) {
    const group = new THREE.Group();
    group.name = `${id} translucent light pool`;

    const height = Math.max(0.1, position.y - 0.16);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 40, 1, true), this._material(color, 0.082));
    cone.name = `${id} volumetric cone`;
    cone.position.set(position.x, position.y - height / 2, position.z);
    cone.renderOrder = -1;

    const disk = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.92, 48), this._material(color, 0.115));
    disk.name = `${id} floor light contact pool`;
    disk.position.copy(target);
    disk.position.y = 0.018;
    disk.rotation.x = -Math.PI / 2;
    disk.renderOrder = -2;

    group.add(cone, disk);
    group.userData.materials = [cone.material, disk.material];
    return group;
  }

  _buildDeskLamp() {
    const id = 'warm-desk-lamp';
    const position = new THREE.Vector3(-3.1, 1.28, -0.52);
    const color = 0xffad5c;

    const stemMat = new THREE.MeshStandardMaterial({
      color: 0x1c1f20,
      metalness: 0.65,
      roughness: 0.43,
    });
    const shadeMat = new THREE.MeshStandardMaterial({
      color: 0x3b2b20,
      emissive: new THREE.Color(0x4b1d08),
      emissiveIntensity: 0.35,
      metalness: 0.2,
      roughness: 0.58,
    });

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.58, 12), stemMat);
    stem.name = 'warm desk lamp bent stem';
    stem.position.set(position.x - 0.22, 0.98, position.z + 0.16);
    this.group.add(stem);

    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.34, 24, 1, true), shadeMat);
    shade.name = 'warm desk lamp amber shade';
    shade.position.copy(position);
    shade.rotation.x = Math.PI;
    this.group.add(shade);

    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), this._bulbMaterial(color, 1.2));
    bulb.name = 'warm desk lamp breakable bulb';
    bulb.position.copy(position).add(new THREE.Vector3(0, -0.08, 0));
    bulb.userData.breakableLight = true;
    bulb.userData.lightId = id;
    this.group.add(bulb);

    const light = new THREE.PointLight(color, 6.6, 5.6, 2);
    light.name = 'warm desk lamp point light';
    light.position.copy(bulb.position);
    light.castShadow = false;
    this.group.add(light);

    const pool = new THREE.Group();
    pool.name = 'warm desk lamp pool';
    const disk = new THREE.Mesh(new THREE.CircleGeometry(1.55, 32), this._material(color, 0.13));
    disk.position.set(-3.1, 0.025, -0.42);
    disk.rotation.x = -Math.PI / 2;
    pool.add(disk);
    pool.userData.materials = [disk.material];
    this.group.add(pool);

    this.list.push({
      id,
      position: light.position.clone(),
      intensity: 0.34,
      range: 5.2,
      alive: true,
      light,
      pool,
      bulb,
      damaged: false,
      _baseLightIntensity: light.intensity,
      _baseEmissiveIntensity: 1.2,
      _basePoolOpacity: 0.13,
      _phase: Math.random() * Math.PI * 2,
      _poolMaterials: pool.userData.materials,
    });
  }

  _buildServerGlow() {
    const id = 'cool-server-rack-glow';
    const color = 0x36d6d0;
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x123234,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.72,
      metalness: 0.25,
      roughness: 0.36,
    });
    const panels = [];

    for (let i = 0; i < 4; i++) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 0.48), panelMat.clone());
      panel.name = 'cool server rack status glow';
      panel.position.set(11.72, 1.03 + i * 0.32, -6.25 + i * 1.15);
      panel.userData.breakableLight = true;
      panel.userData.lightId = id;
      this.group.add(panel);
      panels.push(panel);
    }

    const light = new THREE.PointLight(color, 4.4, 6.2, 2);
    light.name = 'cool server rack spill light';
    light.position.set(10.8, 1.45, -4.55);
    this.group.add(light);

    const pool = new THREE.Group();
    pool.name = 'cool server rack rectangular glow volume';
    const mat = this._material(color, 0.075);
    const haze = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 4.8), mat);
    haze.position.set(10.8, 1.35, -4.55);
    haze.renderOrder = -1;
    pool.add(haze);
    pool.userData.materials = [mat];
    this.group.add(pool);

    this.list.push({
      id,
      position: light.position.clone(),
      intensity: 0.26,
      range: 5.8,
      alive: true,
      light,
      pool,
      bulb: panels[0],
      bulbs: panels,
      damaged: false,
      _baseLightIntensity: light.intensity,
      _baseEmissiveIntensity: 0.72,
      _basePoolOpacity: 0.075,
      _phase: Math.random() * Math.PI * 2,
      _poolMaterials: pool.userData.materials,
    });
  }

  sampleIllumination(position) {
    const origin = _tmpA.copy(position);
    origin.y = Math.max(origin.y + 0.55, 0.65);

    let illumination = 0;
    for (const record of this.list) {
      if (!record.alive) continue;

      const toLight = _tmpB.copy(record.position).sub(origin);
      const dist = toLight.length();
      if (dist <= 0.001 || dist > record.range) continue;

      const distanceFalloff = 1 - dist / record.range;
      const shaped = distanceFalloff * distanceFalloff * (3 - 2 * distanceFalloff);
      const occlusion = this._occluded(origin, toLight, dist) ? 0.16 : 1;

      illumination += shaped * record.intensity * occlusion;
    }

    return THREE.MathUtils.clamp(illumination, 0, 1);
  }

  _occluded(origin, toLight, distance) {
    const direction = _tmpC.copy(toLight).normalize();
    this._raycaster.set(origin, direction);
    this._raycaster.near = 0.05;
    this._raycaster.far = Math.max(0.05, distance - 0.22);
    const hits = this._raycaster.intersectObjects(this._occluders, false);
    return hits.length > 0;
  }

  breakLight(id) {
    const record = this.list.find((light) => light.id === id);
    if (!record || !record.alive) return false;

    record.alive = false;
    record.light.intensity = 0;
    record.pool.visible = false;

    const bulbs = record.bulbs ?? [record.bulb];
    for (const bulb of bulbs) {
      if (!bulb?.material) continue;
      bulb.material.emissiveIntensity = 0;
      bulb.material.color.multiplyScalar(0.18);
      bulb.userData.breakableLight = false;
    }

    this.bus?.emit('light:broken', { id: record.id, position: record.position.clone() });
    return true;
  }

  breakAt(point) {
    const p = _tmpA.copy(point);
    let best = null;
    let bestDist = Infinity;

    for (const record of this.list) {
      if (!record.alive) continue;
      const bulbs = record.bulbs ?? [record.bulb];
      for (const bulb of bulbs) {
        if (!bulb) continue;
        bulb.getWorldPosition(_tmpB);
        const d = _tmpB.distanceTo(p);
        if (d < bestDist) {
          best = record;
          bestDist = d;
        }
      }
    }

    if (!best || bestDist > 1.35) return null;
    this.breakLight(best.id);
    return best;
  }

  update(dt) {
    this._time += dt;

    for (const record of this.list) {
      if (!record.alive) continue;

      const baseFlutter =
        Math.sin(this._time * 4.7 + record._phase) * 0.018 +
        Math.sin(this._time * 9.9 + record._phase * 0.37) * 0.011;
      const damageFlutter = record.damaged
        ? Math.sin(this._time * 21.0 + record._phase) * 0.09 +
          (Math.sin(this._time * 5.0 + record._phase * 2.1) > 0.92 ? -0.28 : 0)
        : 0;

      const flicker = THREE.MathUtils.clamp(1 + baseFlutter + damageFlutter, 0.28, 1.14);
      record.light.intensity = record._baseLightIntensity * flicker;

      const bulbs = record.bulbs ?? [record.bulb];
      for (const bulb of bulbs) {
        if (bulb?.material?.emissiveIntensity !== undefined) {
          bulb.material.emissiveIntensity = record._baseEmissiveIntensity * flicker;
        }
      }

      for (const material of record._poolMaterials ?? []) {
        material.opacity = record._basePoolOpacity * THREE.MathUtils.clamp(flicker, 0.35, 1.08);
      }
    }
  }
}
