import * as THREE from 'three';
import { HITSCAN_LAYERS } from '../combat/Hitscan.js';
import { concrete, emissiveTrim, glass, metal, paintedMetal } from '../rendering/Materials.js';
import { MATERIAL_KEYS } from './LevelDef.js';

const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
const _tmpC = new THREE.Vector3();
const _tmpD = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function toVector3(value, fallback = new THREE.Vector3()) {
  if (value?.isVector3) return value.clone();
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return new THREE.Vector3(value.x, value.y, value.z);
  }
  return fallback.clone();
}

function setUv2(geometry) {
  if (geometry.attributes.uv && !geometry.attributes.uv2) {
    geometry.setAttribute('uv2', geometry.attributes.uv.clone());
  }
  return geometry;
}

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function isActiveOccluder(object) {
  return Boolean(object?.visible && object.isMesh && !object.userData?.lightVolume);
}

class LevelLightSystem {
  constructor(scene, bus, group, occluders = []) {
    this.scene = scene;
    this.bus = bus;
    this.group = group;
    this.room = { occluders };
    this.list = [];
    this._time = 0;
    this._occluders = occluders;
    this._raycaster = new THREE.Raycaster();
    this._budget = {
      shadowsEnabled: true,
      shadowCastersEnabled: true,
      maxShadowCasters: 1,
      shadowMapSize: 512,
      lightVolumesEnabled: true,
    };
    this._shadowCasterLimit = 1;
    this._shadowCasterCount = 0;

    this.ambient = new THREE.AmbientLight(0x111922, 0.035);
    this.ambient.name = 'level ambient shadow lift';
    this.group.add(this.ambient);
  }

  buildLights(lightDefs = []) {
    for (const lightDef of lightDefs) this._createLight(lightDef);
    return this;
  }

  sampleIllumination(position) {
    const origin = _tmpA.copy(position);
    origin.y = Math.max(origin.y + 0.55, 0.65);

    let illumination = 0;
    for (const record of this.list) {
      if (!record.alive || !record.light || record.light.intensity <= 0) continue;

      const toLight = _tmpB.copy(record.position).sub(origin);
      const distance = toLight.length();
      if (distance <= 0.001 || distance > record.range) continue;

      const coneWeight = this._coneWeight(record, origin);
      if (coneWeight <= 0.001) continue;

      const distanceFalloff = 1 - distance / record.range;
      const shaped = distanceFalloff * distanceFalloff * (3 - 2 * distanceFalloff);
      const occlusion = this._occluded(origin, toLight, distance) ? 0.16 : 1;
      illumination += shaped * record.intensity * coneWeight * occlusion;
    }

    return THREE.MathUtils.clamp(illumination, 0, 1);
  }

  breakLight(id) {
    const record = this.list.find((light) => light.id === id);
    if (!record || !record.alive) return false;

    record.broken = true;
    record.enabled = false;
    record.alive = false;
    this._syncRecordVisibility(record);
    this.bus?.emit('light:broken', { id: record.id, position: record.position.clone() });
    return true;
  }

  breakAt(point) {
    const p = toVector3(point);
    let best = null;
    let bestDistance = Infinity;
    for (const record of this.list) {
      if (!record.alive) continue;
      const bulbs = record.bulbs ?? [record.bulb];
      for (const bulb of bulbs) {
        if (!bulb) continue;
        bulb.getWorldPosition(_tmpA);
        const distance = _tmpA.distanceTo(p);
        if (distance < bestDistance) {
          best = record;
          bestDistance = distance;
        }
      }
    }
    if (!best || bestDistance > 1.35) return null;
    this.breakLight(best.id);
    return best;
  }

  setLightEnabled(id, enabled) {
    const record = this.list.find((light) => light.id === id);
    if (!record) return false;
    record.enabled = Boolean(enabled);
    record.alive = record.enabled && !record.broken;
    this._syncRecordVisibility(record);
    return true;
  }

  applyBudget(snapshot = {}) {
    this._budget = { ...this._budget, ...snapshot };
    const shadowsEnabled =
      this._budget.shadowsEnabled !== false && this._budget.shadowCastersEnabled !== false;
    const maxCasters = Math.max(0, Math.floor(this._budget.maxShadowCasters ?? this._shadowCasterLimit));
    const mapSize = this._budget.shadowMapSize ?? 512;
    let enabledCasters = 0;

    for (const record of this.list) {
      const enableShadow = Boolean(record.alive && record._wantsShadow && shadowsEnabled && enabledCasters < maxCasters);
      record.light.castShadow = enableShadow;
      if (enableShadow) {
        enabledCasters++;
        record.light.shadow?.mapSize?.set?.(mapSize, mapSize);
      }

      record.pool.userData.budgetCost = 'light-volume';
      record.pool.visible = record.alive && this._budget.lightVolumesEnabled !== false;
    }
  }

  update(dt) {
    this._time += dt;
    for (const record of this.list) {
      if (!record.alive) continue;

      const baseFlutter =
        Math.sin(this._time * 4.4 + record._phase) * 0.018 +
        Math.sin(this._time * 9.1 + record._phase * 0.41) * 0.01;
      const alarmFlutter = record.role === 'alarm'
        ? Math.sin(this._time * 15.8 + record._phase) * 0.08
        : 0;
      const trapFlutter = record.role === 'trap' && Math.sin(this._time * 6.5 + record._phase) > 0.92 ? -0.18 : 0;
      const flicker = THREE.MathUtils.clamp(1 + baseFlutter + alarmFlutter + trapFlutter, 0.28, 1.16);

      record.light.intensity = record._baseLightIntensity * flicker;
      for (const bulb of record.bulbs ?? [record.bulb]) {
        if (bulb?.material?.emissiveIntensity !== undefined) {
          bulb.material.emissiveIntensity = record._baseEmissiveIntensity * flicker;
        }
      }
      for (const material of record._poolMaterials ?? []) {
        material.opacity = (material.userData.baseOpacity ?? record._basePoolOpacity) *
          THREE.MathUtils.clamp(flicker, 0.35, 1.08);
      }
    }
  }

  _createLight(lightDef) {
    const id = lightDef.id;
    const color = lightDef.color ?? 0xff982b;
    const position = new THREE.Vector3(lightDef.x ?? 0, lightDef.y ?? 2.6, lightDef.z ?? 0);
    const target = lightDef.target
      ? toVector3(lightDef.target)
      : new THREE.Vector3(position.x, Math.max(0.04, position.y - 2.2), position.z);
    const hasTarget = Boolean(lightDef.target);
    const range = lightDef.range ?? 8;
    const role = lightDef.role ?? 'fill';

    const fixture = new THREE.Mesh(
      setUv2(new THREE.BoxGeometry(0.98, 0.08, 0.34)),
      new THREE.MeshStandardMaterial({
        color: 0x20262a,
        metalness: 0.72,
        roughness: 0.54,
      }),
    );
    fixture.name = `${id} light-first fixture`;
    fixture.position.copy(position).add(new THREE.Vector3(0, 0.06, 0));
    fixture.castShadow = true;
    fixture.receiveShadow = true;
    this.group.add(fixture);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(lightDef.breakable === false ? 0.115 : 0.15, 16, 10),
      this._bulbMaterial(color, lightDef.breakable === false ? 0.85 : 1.35),
    );
    bulb.name = `${id} ${lightDef.breakable === false ? 'protected glow' : 'breakable bulb'}`;
    bulb.position.copy(position);
    bulb.userData.lightId = id;
    bulb.userData.breakableLight = lightDef.breakable !== false;
    bulb.userData.combatLayer = HITSCAN_LAYERS.lights;
    bulb.castShadow = false;
    this.group.add(bulb);

    let light;
    if (hasTarget) {
      light = new THREE.SpotLight(color, lightDef.intensity ?? 12, range, lightDef.angle ?? Math.PI / 4.7, 0.78, 2);
      light.target.position.copy(target);
      const wantsShadow = lightDef.shadows ?? (role === 'key' || role === 'trap');
      light.castShadow = wantsShadow && this._shadowCasterCount < this._shadowCasterLimit;
      if (light.castShadow) {
        this._shadowCasterCount++;
        light.shadow.mapSize.set(512, 512);
        light.shadow.bias = -0.00018;
        light.shadow.normalBias = 0.018;
        light.shadow.camera.near = 0.4;
        light.shadow.camera.far = range + 2;
      }
      this.group.add(light.target);
    } else {
      light = new THREE.PointLight(color, lightDef.intensity ?? 5, range, 2);
      light.castShadow = false;
    }
    light.name = `${id} real level light`;
    light.position.copy(position);
    this.group.add(light);

    const pool = this._createLightPool(id, position, target, color, range, hasTarget);
    this.group.add(pool);

    const enabled = lightDef.enabled !== false;
    const record = {
      id,
      role,
      position: position.clone(),
      target: target.clone(),
      direction: hasTarget ? target.clone().sub(position).normalize() : null,
      angle: light.angle,
      intensity: lightDef.sample ?? THREE.MathUtils.clamp((lightDef.intensity ?? 10) / 27, 0.16, 0.9),
      range,
      enabled,
      broken: false,
      breakable: lightDef.breakable !== false,
      alive: enabled,
      light,
      fixture,
      pool,
      bulb,
      _wantsShadow: hasTarget ? (lightDef.shadows ?? (role === 'key' || role === 'trap')) : false,
      _baseLightIntensity: light.intensity,
      _baseEmissiveIntensity: bulb.material.emissiveIntensity ?? 1,
      _basePoolOpacity: pool.userData.baseOpacity ?? 0.075,
      _phase: Math.random() * Math.PI * 2,
      _poolMaterials: pool.userData.materials,
    };
    this.list.push(record);
    this._syncRecordVisibility(record);
  }

  _createLightPool(id, position, target, color, range, hasTarget) {
    const group = new THREE.Group();
    group.name = `${id} light-first visible pool`;
    const materials = [];
    const radius = Math.max(1.35, Math.min(range * 0.42, 4.2));

    if (hasTarget) {
      const height = Math.max(0.1, position.distanceTo(target));
      const coneMaterial = this._volumeMaterial(color, 0.052);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 36, 1, true), coneMaterial);
      cone.name = `${id} volumetric cone`;
      cone.position.copy(position).add(target).multiplyScalar(0.5);
      cone.quaternion.setFromUnitVectors(_up, _tmpD.copy(position).sub(target).normalize());
      cone.renderOrder = -1;
      this._tagLightVolume(cone);
      group.add(cone);
      materials.push(coneMaterial);
    }

    const diskRadius = hasTarget ? radius * 0.9 : Math.max(1.4, Math.min(range * 0.32, 2.8));
    const diskMaterial = this._volumeMaterial(color, hasTarget ? 0.088 : 0.07);
    const disk = new THREE.Mesh(new THREE.CircleGeometry(diskRadius, 48), diskMaterial);
    disk.name = `${id} floor contact pool`;
    disk.position.copy(target);
    disk.position.y = 0.022;
    disk.rotation.x = -Math.PI / 2;
    disk.renderOrder = -2;
    this._tagLightVolume(disk);
    group.add(disk);
    materials.push(diskMaterial);

    group.userData.materials = materials;
    group.userData.baseOpacity = hasTarget ? 0.088 : 0.07;
    return group;
  }

  _tagLightVolume(mesh) {
    mesh.userData.perceptionIgnore = true;
    mesh.userData.lightVolume = true;
    mesh.userData.combatIgnore = true;
    mesh.userData.budgetCost = 'light-volume';
    return mesh;
  }

  _volumeMaterial(color, opacity) {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    material.userData.baseOpacity = opacity;
    return material;
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

  _syncRecordVisibility(record) {
    const visible = record.enabled && !record.broken;
    record.alive = visible;
    record.light.visible = visible;
    record.light.intensity = visible ? record._baseLightIntensity : 0;
    record.pool.visible = visible && this._budget.lightVolumesEnabled !== false;
    record.bulb.visible = visible || !record.broken;
    record.bulb.userData.breakableLight = visible && record.breakable;
    if (record.bulb.material?.emissiveIntensity !== undefined) {
      record.bulb.material.emissiveIntensity = visible ? record._baseEmissiveIntensity : 0;
    }
    if (record.broken && record.bulb.material?.color) record.bulb.material.color.multiplyScalar(0.18);
  }

  _coneWeight(record, origin) {
    if (!record.direction && !record.target) return 1;
    const direction = record.direction
      ? _tmpC.copy(record.direction)
      : _tmpC.copy(record.target).sub(record.position).normalize();
    const toSample = _tmpD.copy(origin).sub(record.position);
    if (toSample.lengthSq() <= 0.000001) return 1;
    toSample.normalize();

    const angle = record.angle ?? Math.PI / 3;
    const outer = Math.cos(angle);
    const inner = Math.cos(angle * 0.58);
    const dot = THREE.MathUtils.clamp(toSample.dot(direction), -1, 1);
    return smoothstep(outer, inner, dot);
  }

  _occluded(origin, toLight, distance) {
    const occluders = this._occluders.filter(isActiveOccluder);
    if (occluders.length === 0) return false;
    const direction = _tmpC.copy(toLight).normalize();
    this._raycaster.set(origin, direction);
    this._raycaster.near = 0.05;
    this._raycaster.far = Math.max(0.05, distance - 0.22);
    return this._raycaster.intersectObjects(occluders, false).length > 0;
  }
}

export class LightFirstBuilder {
  constructor(scene, bus, lightsSystemFactory = null) {
    this.scene = scene;
    this.bus = bus;
    this.lightsSystemFactory = lightsSystemFactory;
    this.group = null;
    this.lightGroup = null;
    this.geometryGroup = null;
    this.lights = null;
    this.colliders = [];
    this.colliderMeshes = [];
    this.occluders = [];
    this.decalReceivers = [];
    this.shutters = new Map();
    this.materials = this._createMaterials();
  }

  build(levelDef) {
    this.clear();
    this.level = levelDef;
    this.group = new THREE.Group();
    this.group.name = `${levelDef.id} light-first level`;
    this.lightGroup = new THREE.Group();
    this.lightGroup.name = `${levelDef.id} lights`;
    this.geometryGroup = new THREE.Group();
    this.geometryGroup.name = `${levelDef.id} geometry`;
    this.group.add(this.lightGroup);
    this.scene.add(this.group);

    this.lights = this._buildLightSystem(levelDef);
    this.group.add(this.geometryGroup);
    this._buildGeometry(levelDef.geometry ?? []);
    this._buildExtractMarker(levelDef.extract);
    this.refreshColliders();

    return this._result();
  }

  clear() {
    if (this.group?.parent) this.group.parent.remove(this.group);
    this.group = null;
    this.lightGroup = null;
    this.geometryGroup = null;
    this.lights = null;
    this.level = null;
    this.colliders.length = 0;
    this.colliderMeshes.length = 0;
    this.occluders.length = 0;
    this.decalReceivers.length = 0;
    this.shutters.clear();
  }

  refreshColliders() {
    this.colliders.length = 0;
    for (const mesh of this.colliderMeshes) {
      if (!mesh?.visible) continue;
      mesh.updateMatrixWorld(true);
      this.colliders.push(new THREE.Box3().setFromObject(mesh));
    }
    return this.colliders;
  }

  setShutterOpen(id, open) {
    const shutter = this.shutters.get(id);
    if (!shutter) return false;
    shutter.visible = !open;
    shutter.userData.open = Boolean(open);
    this.refreshColliders();
    return true;
  }

  applyAlarmLayout(layout = null) {
    if (!layout) return false;
    for (const id of layout.disableLightIds ?? []) this.lights?.setLightEnabled?.(id, false);
    for (const id of layout.enableLightIds ?? []) this.lights?.setLightEnabled?.(id, true);
    for (const id of layout.openShutters ?? []) this.setShutterOpen(id, true);
    for (const id of layout.closeShutters ?? []) this.setShutterOpen(id, false);
    return true;
  }

  _buildLightSystem(levelDef) {
    const custom = this.lightsSystemFactory?.(this.scene, this.bus, levelDef, {
      group: this.lightGroup,
      occluders: this.occluders,
    });
    if (custom) {
      custom.room ??= { occluders: this.occluders };
      if (typeof custom.buildLights === 'function') custom.buildLights(levelDef.lights ?? []);
      return custom;
    }

    return new LevelLightSystem(this.scene, this.bus, this.lightGroup, this.occluders)
      .buildLights(levelDef.lights ?? []);
  }

  _buildGeometry(geometryDefs) {
    for (const def of geometryDefs) {
      switch (def.type) {
        case 'floor':
          this._buildFloor(def);
          break;
        case 'stairs':
          this._buildStairs(def);
          break;
        case 'catwalk':
          this._buildCatwalk(def);
          break;
        case 'shutter':
          this._buildShutter(def);
          break;
        case 'box':
        default:
          this._box(def.id ?? 'level box', def);
          break;
      }
    }
  }

  _buildFloor(def) {
    this._box(def.id ?? 'level floor', {
      ...def,
      y: (def.y ?? 0) - 0.08,
      h: 0.16,
      collider: def.collider ?? true,
      receiveDecals: def.receiveDecals ?? true,
      reflectiveFloor: true,
    });
  }

  _buildShutter(def) {
    const mesh = this._box(def.id ?? 'level shutter', {
      ...def,
      collider: def.collider ?? true,
      occluder: def.occluder ?? true,
    });
    mesh.userData.shutterId = def.id;
    this.shutters.set(def.id, mesh);
    this.setShutterOpen(def.id, def.open === true);
  }

  _buildStairs(def) {
    const steps = Math.max(2, Math.floor(def.steps ?? 8));
    const yaw = def.yaw ?? 0;
    const tread = (def.d ?? 4) / steps;
    const riser = (def.h ?? 1.8) / steps;
    for (let i = 0; i < steps; i++) {
      const localZ = -(def.d ?? 4) * 0.5 + tread * (i + 0.5);
      const x = (def.x ?? 0) + Math.sin(yaw) * localZ;
      const z = (def.z ?? 0) + Math.cos(yaw) * localZ;
      this._box(`${def.id ?? 'stairs'} step ${i + 1}`, {
        x,
        y: (def.y ?? 0) + riser * (i + 0.5),
        z,
        w: def.w ?? 2,
        h: riser,
        d: tread * 0.95,
        yaw,
        material: def.material ?? MATERIAL_KEYS.blackSteel,
        collider: def.collider ?? true,
        occluder: def.occluder ?? false,
      });
    }
  }

  _buildCatwalk(def) {
    const y = def.y ?? 3;
    const platform = this._box(`${def.id ?? 'catwalk'} deck`, {
      ...def,
      y,
      h: def.h ?? 0.18,
      material: def.material ?? MATERIAL_KEYS.steel,
      collider: def.collider ?? true,
      occluder: def.occluder ?? true,
    });
    platform.userData.catwalkId = def.id;

    const railHeight = def.railHeight ?? 0.8;
    const railThickness = 0.08;
    const hasWideAxis = (def.w ?? 1) >= (def.d ?? 1);
    if (hasWideAxis) {
      this._box(`${def.id ?? 'catwalk'} north rail`, {
        x: def.x,
        y: y + railHeight * 0.5,
        z: (def.z ?? 0) - (def.d ?? 1) * 0.5,
        w: def.w,
        h: railHeight,
        d: railThickness,
        yaw: def.yaw,
        material: MATERIAL_KEYS.blackSteel,
        collider: false,
        occluder: false,
      });
      this._box(`${def.id ?? 'catwalk'} south rail`, {
        x: def.x,
        y: y + railHeight * 0.5,
        z: (def.z ?? 0) + (def.d ?? 1) * 0.5,
        w: def.w,
        h: railHeight,
        d: railThickness,
        yaw: def.yaw,
        material: MATERIAL_KEYS.blackSteel,
        collider: false,
        occluder: false,
      });
    } else {
      this._box(`${def.id ?? 'catwalk'} west rail`, {
        x: (def.x ?? 0) - (def.w ?? 1) * 0.5,
        y: y + railHeight * 0.5,
        z: def.z,
        w: railThickness,
        h: railHeight,
        d: def.d,
        yaw: def.yaw,
        material: MATERIAL_KEYS.blackSteel,
        collider: false,
        occluder: false,
      });
      this._box(`${def.id ?? 'catwalk'} east rail`, {
        x: (def.x ?? 0) + (def.w ?? 1) * 0.5,
        y: y + railHeight * 0.5,
        z: def.z,
        w: railThickness,
        h: railHeight,
        d: def.d,
        yaw: def.yaw,
        material: MATERIAL_KEYS.blackSteel,
        collider: false,
        occluder: false,
      });
    }
  }

  _buildExtractMarker(extract) {
    const p = toVector3(extract);
    const mat = this.materials.green;
    this._box('level extract left glow strip', {
      x: p.x - 0.72,
      y: 1.08,
      z: p.z + 0.12,
      w: 0.045,
      h: 2.05,
      d: 0.04,
      material: MATERIAL_KEYS.green,
      collider: false,
      occluder: false,
      castShadow: false,
    });
    this._box('level extract right glow strip', {
      x: p.x + 0.72,
      y: 1.08,
      z: p.z + 0.12,
      w: 0.045,
      h: 2.05,
      d: 0.04,
      material: MATERIAL_KEYS.green,
      collider: false,
      occluder: false,
      castShadow: false,
    });
    const marker = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.18, 36), mat);
    marker.name = 'level extract floor ring';
    marker.position.set(p.x, 0.035, p.z);
    marker.rotation.x = -Math.PI / 2;
    marker.userData.perceptionIgnore = true;
    marker.userData.combatIgnore = true;
    this.geometryGroup.add(marker);
  }

  _box(name, def) {
    const geometry = setUv2(new THREE.BoxGeometry(def.w ?? 1, def.h ?? 1, def.d ?? 1));
    const material = this._material(def.material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(def.x ?? 0, def.y ?? 0, def.z ?? 0);
    mesh.rotation.y = def.yaw ?? 0;
    mesh.castShadow = def.castShadow ?? true;
    mesh.receiveShadow = def.receiveShadow ?? true;
    mesh.userData.combatLayer = HITSCAN_LAYERS.world;
    mesh.userData.levelGeometry = def;

    const surface = this._surfaceFromMaterial(material);
    if (surface) mesh.userData.surface = surface;
    if (def.receiveDecals) {
      mesh.userData.receiveDecals = true;
      this.decalReceivers.push(mesh);
    }
    if (def.reflectiveFloor) mesh.userData.reflectiveFloor = true;
    if (def.occluder) {
      mesh.userData.lightOccluder = true;
      this.occluders.push(mesh);
    }
    if (def.collider) this.colliderMeshes.push(mesh);

    this.geometryGroup.add(mesh);
    return mesh;
  }

  _material(key = MATERIAL_KEYS.wall) {
    return this.materials[key] ?? this.materials.wall;
  }

  _surfaceFromMaterial(material) {
    if (Array.isArray(material)) {
      return material.find((mat) => mat?.userData?.surface)?.userData.surface;
    }
    return material?.userData?.surface;
  }

  _result() {
    return {
      group: this.group,
      lights: this.lights,
      colliders: this.colliders,
      occluders: this.occluders,
      decalReceivers: this.decalReceivers,
      shutters: this.shutters,
    };
  }

  _createMaterials() {
    return {
      [MATERIAL_KEYS.floor]: concrete({
        name: 'level scuffed concrete floor',
        color: 0x182124,
        roughness: 0.74,
        envMapIntensity: 0.3,
        repeat: [9, 7],
        panel: [7, 5],
        seamWidth: 0.009,
        edgeWearStrength: 1.22,
        seed: 101,
      }),
      [MATERIAL_KEYS.wall]: paintedMetal({
        name: 'level cold blue-gray wall panels',
        color: 0x202c32,
        roughness: 0.74,
        metalness: 0.22,
        repeat: [5, 3],
        panel: [5, 3],
        stencils: true,
        labelColor: 0xcf8028,
        seed: 102,
      }),
      [MATERIAL_KEYS.darkWall]: concrete({
        name: 'level dirty green-black concrete wall',
        color: 0x151d1f,
        roughness: 0.9,
        repeat: [5.5, 3.1],
        panel: [4, 3],
        stencils: true,
        labelColor: 0xb56f24,
        seed: 103,
      }),
      [MATERIAL_KEYS.steel]: metal({
        name: 'level oxidized blue steel',
        color: 0x364a51,
        roughness: 0.58,
        panel: [3, 3],
        seed: 104,
      }),
      [MATERIAL_KEYS.blackSteel]: metal({
        name: 'level dirty green-black structural steel',
        color: 0x0f1918,
        roughness: 0.62,
        metalness: 0.7,
        panel: [2, 4],
        seed: 105,
      }),
      [MATERIAL_KEYS.crate]: paintedMetal({
        name: 'level worn olive storage crate',
        color: 0x2a3528,
        roughness: 0.76,
        metalness: 0.28,
        repeat: [2, 2],
        panel: [2, 2],
        seed: 106,
      }),
      [MATERIAL_KEYS.vehicle]: paintedMetal({
        name: 'level dirty fleet vehicle enamel',
        color: 0x26332f,
        roughness: 0.7,
        metalness: 0.34,
        repeat: [3, 2],
        panel: [3, 2],
        seed: 107,
      }),
      [MATERIAL_KEYS.glass]: glass({ color: 0x68848a, opacity: 0.28, roughness: 0.28 }),
      [MATERIAL_KEYS.amber]: emissiveTrim({
        name: 'level sodium amber trim',
        color: 0xff982b,
        intensity: 0.48,
      }),
      [MATERIAL_KEYS.green]: emissiveTrim({
        name: 'level dirty green extract trim',
        color: 0x7ea06b,
        intensity: 0.72,
      }),
    };
  }
}
