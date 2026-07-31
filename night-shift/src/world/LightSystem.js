import * as THREE from 'three';
import { CONFIG } from '../config.js';

const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
const _tmpC = new THREE.Vector3();
const _tmpD = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

const poolVertexShader = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorld;

void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const conePoolFragmentShader = /* glsl */ `
uniform vec3 color;
uniform float opacity;
uniform float radius;
uniform float height;
uniform float time;
uniform float seed;
varying vec3 vLocal;
varying vec3 vWorld;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.73 + seed);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  float h = max(height, 0.001);
  float t = clamp(vLocal.y / h + 0.5, 0.0, 1.0);
  float coneRadius = max(radius * (1.0 - t), 0.025);
  float radial = length(vLocal.xz) / coneRadius;
  float radialFalloff = pow(1.0 - smoothstep(0.12, 1.0, radial), 1.35);
  float verticalFalloff = smoothstep(0.015, 0.2, t) * (1.0 - smoothstep(0.9, 1.0, t));
  float breakup = noise(vWorld.xz * 0.92 + vec2(seed, -seed) + time * 0.015);
  breakup = mix(breakup, noise(vWorld.xy * 1.35 + seed * 2.7), 0.38);
  float smoke = smoothstep(0.08, 0.92, breakup + radial * 0.08);
  float alpha = opacity * radialFalloff * verticalFalloff * mix(0.48, 1.06, smoke);
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(color, alpha);
}
`;

const diskPoolFragmentShader = /* glsl */ `
uniform vec3 color;
uniform float opacity;
uniform float radius;
uniform float time;
uniform float seed;
varying vec3 vLocal;
varying vec3 vWorld;

float hash(vec2 p) {
  p = fract(p * vec2(269.5, 183.3));
  p += dot(p, p + 41.19 + seed);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  float radial = length(vLocal.xy) / max(radius, 0.001);
  float falloff = 1.0 - smoothstep(0.14, 1.0, radial);
  float centerCut = 0.72 + smoothstep(0.0, 0.35, radial) * 0.28;
  float breakup = noise(vWorld.xz * 1.7 + seed + time * 0.01);
  float alpha = opacity * falloff * centerCut * mix(0.62, 1.08, breakup);
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(color, alpha);
}
`;

const hazePlaneFragmentShader = /* glsl */ `
uniform vec3 color;
uniform float opacity;
uniform float width;
uniform float height;
uniform float time;
uniform float seed;
varying vec3 vLocal;
varying vec3 vWorld;

float hash(vec2 p) {
  p = fract(p * vec2(113.5, 271.9));
  p += dot(p, p + 37.21 + seed);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 normalized = vec2(vLocal.x / max(width * 0.5, 0.001), vLocal.y / max(height * 0.5, 0.001));
  float radial = length(normalized);
  float falloff = 1.0 - smoothstep(0.16, 1.0, radial);
  float breakup = noise(vWorld.zy * 1.25 + vec2(seed, time * 0.018));
  float alpha = opacity * falloff * mix(0.48, 1.0, breakup);
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(color, alpha);
}
`;

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
    this._budget = {
      shadowsEnabled: true,
      shadowCastersEnabled: true,
      maxShadowCasters: 1,
      shadowMapSize: 512,
      lightVolumesEnabled: true,
    };
    this._shadowCasterLimit = 1;
    this._shadowCasterCount = 0;

    scene.add(this.group);

    this.ambient = new THREE.AmbientLight(0x111922, 0.032);
    scene.add(this.ambient);

    this._buildCeilingFixtures();
    this._buildDeskLamp();
    this._buildServerGlow();
  }

  _shaderMaterial(fragmentShader, color, opacity, extraUniforms = {}) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(color) },
        opacity: { value: opacity },
        time: { value: 0 },
        seed: { value: Math.random() * 1000 },
        ...extraUniforms,
      },
      vertexShader: poolVertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    material.userData.baseOpacity = opacity;
    return material;
  }

  _conePoolMaterial(color, opacity, radius, height) {
    return this._shaderMaterial(conePoolFragmentShader, color, opacity, {
      radius: { value: radius },
      height: { value: height },
    });
  }

  _diskPoolMaterial(color, opacity, radius) {
    return this._shaderMaterial(diskPoolFragmentShader, color, opacity, {
      radius: { value: radius },
    });
  }

  _hazePlaneMaterial(color, opacity, width, height) {
    return this._shaderMaterial(hazePlaneFragmentShader, color, opacity, {
      width: { value: width },
      height: { value: height },
    });
  }

  _tagLightVolume(mesh) {
    mesh.userData.perceptionIgnore = true;
    mesh.userData.lightVolume = true;
    mesh.userData.budgetCost = 'light-volume';
    return mesh;
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
        color: 0x9fb8c5,
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
        color: 0x96b2c1,
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
        color: 0xd69a46,
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
        color: 0x8eaebd,
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
    const wantsShadow = Boolean(shadows);
    light.castShadow = wantsShadow && this._shadowCasterCount < this._shadowCasterLimit;
    if (light.castShadow) {
      this._shadowCasterCount++;
      light.shadow.mapSize.set(512, 512);
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
      target: target.clone(),
      direction: target.clone().sub(position).normalize(),
      angle: light.angle,
      intensity: sample,
      range,
      alive: true,
      light,
      pool,
      bulb,
      damaged,
      _wantsShadow: wantsShadow,
      _baseLightIntensity: lightIntensity,
      _baseEmissiveIntensity: 1.4,
      _basePoolOpacity: 0.072,
      _phase: Math.random() * Math.PI * 2,
      _poolMaterials: pool.userData.materials,
    });
  }

  _createCeilingPool(id, position, target, color, radius) {
    const group = new THREE.Group();
    group.name = `${id} shader volumetric light pool`;

    const height = Math.max(0.1, position.distanceTo(target));
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(radius, height, 48, 1, true),
      this._conePoolMaterial(color, 0.072, radius, height)
    );
    this._tagLightVolume(cone);
    cone.name = `${id} volumetric cone`;
    cone.position.copy(position).add(target).multiplyScalar(0.5);
    cone.quaternion.setFromUnitVectors(_up, _tmpD.copy(position).sub(target).normalize());
    cone.renderOrder = -1;

    const diskRadius = radius * 0.94;
    const disk = new THREE.Mesh(
      new THREE.CircleGeometry(diskRadius, 64),
      this._diskPoolMaterial(color, 0.105, diskRadius)
    );
    this._tagLightVolume(disk);
    disk.name = `${id} shader floor light contact pool`;
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
    const disk = new THREE.Mesh(new THREE.CircleGeometry(1.55, 48), this._diskPoolMaterial(color, 0.105, 1.55));
    this._tagLightVolume(disk);
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
      _basePoolOpacity: 0.105,
      _phase: Math.random() * Math.PI * 2,
      _poolMaterials: pool.userData.materials,
    });
  }

  _buildServerGlow() {
    const id = 'cool-server-rack-glow';
    const color = 0x6bb6a2;
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x102b25,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.62,
      metalness: 0.25,
      roughness: 0.42,
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

    const light = new THREE.PointLight(color, 3.8, 6.2, 2);
    light.name = 'cool server rack spill light';
    light.position.set(10.8, 1.45, -4.55);
    this.group.add(light);

    const pool = new THREE.Group();
    pool.name = 'cool server rack layered shader haze';
    const materials = [];
    const makeHaze = (name, width, height, position, rotationY, opacity) => {
      const mat = this._hazePlaneMaterial(color, opacity, width, height);
      const haze = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 1), mat);
      this._tagLightVolume(haze);
      haze.name = name;
      haze.position.copy(position);
      haze.rotation.y = rotationY;
      haze.renderOrder = -1;
      pool.add(haze);
      materials.push(mat);
    };

    makeHaze('server rack vertical haze sheet', 4.9, 2.25, new THREE.Vector3(10.86, 1.35, -4.55), Math.PI / 2, 0.058);
    makeHaze('server rack angled spill haze', 3.6, 1.8, new THREE.Vector3(10.35, 1.1, -4.45), Math.PI / 2.65, 0.044);
    makeHaze('server rack low skim haze', 4.6, 0.85, new THREE.Vector3(10.55, 0.58, -4.55), Math.PI / 2, 0.038);

    const disk = new THREE.Mesh(new THREE.CircleGeometry(2.85, 56), this._diskPoolMaterial(color, 0.052, 2.85));
    this._tagLightVolume(disk);
    disk.name = 'server rack floor spill';
    disk.position.set(10.7, 0.024, -4.55);
    disk.rotation.x = -Math.PI / 2;
    pool.add(disk);
    materials.push(disk.material);
    pool.userData.materials = materials;
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
      _baseEmissiveIntensity: 0.62,
      _basePoolOpacity: 0.058,
      _phase: Math.random() * Math.PI * 2,
      _poolMaterials: pool.userData.materials,
    });
  }

  sampleIllumination(position) {
    const origin = _tmpA.copy(position);
    origin.y = Math.max(origin.y + 0.55, 0.65);

    let illumination = 0;
    for (const record of this.list) {
      if (!record.alive || !record.light || record.light.intensity <= 0) continue;

      const toLight = _tmpB.copy(record.position).sub(origin);
      const dist = toLight.length();
      if (dist <= 0.001 || dist > record.range) continue;

      const coneWeight = this._coneWeight(record, origin);
      if (coneWeight <= 0.001) continue;

      const distanceFalloff = 1 - dist / record.range;
      const shaped = distanceFalloff * distanceFalloff * (3 - 2 * distanceFalloff);
      const occlusion = this._occluded(origin, toLight, dist) ? 0.16 : 1;

      illumination += shaped * record.intensity * coneWeight * occlusion;
    }

    return THREE.MathUtils.clamp(illumination, 0, 1);
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

  applyBudget(snapshot = {}) {
    this._budget = { ...this._budget, ...snapshot };
    const shadowsEnabled =
      this._budget.shadowsEnabled !== false && this._budget.shadowCastersEnabled !== false;
    const maxCasters = Math.max(0, Math.floor(this._budget.maxShadowCasters ?? this._shadowCasterLimit));
    const mapSize = this._budget.shadowMapSize ?? 512;
    let enabledCasters = 0;

    for (const record of this.list) {
      const light = record.light;
      if (!light) continue;

      const enableShadow = Boolean(record._wantsShadow && shadowsEnabled && enabledCasters < maxCasters);
      light.castShadow = enableShadow;
      if (enableShadow) {
        enabledCasters++;
        light.shadow?.mapSize?.set?.(mapSize, mapSize);
      }

      if (record.pool) {
        record.pool.userData.budgetCost = 'light-volume';
        record.pool.visible = record.alive && this._budget.lightVolumesEnabled !== false;
      }
    }
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
        const opacity = (material.userData?.baseOpacity ?? record._basePoolOpacity) *
          THREE.MathUtils.clamp(flicker, 0.35, 1.08);
        if (material.uniforms?.opacity) material.uniforms.opacity.value = opacity;
        else material.opacity = opacity;
        if (material.uniforms?.time) material.uniforms.time.value = this._time;
      }
    }
  }
}
