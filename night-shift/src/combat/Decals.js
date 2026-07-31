import * as THREE from 'three';
import { ProjectedDecal } from './ProjectedDecal.js';

const _point = new THREE.Vector3();
const _normal = new THREE.Vector3();

const SURFACE_PRESETS = {
  concrete: {
    texture: 'scorch',
    color: 0x17100c,
    opacity: [0.58, 0.78],
    size: 1,
    depth: 0.07,
    ttl: [14, 19],
    sparkColor: [0xffb45d, 0xffd08a],
    sparkCount: 9,
  },
  metal: {
    texture: 'rim',
    color: 0xb39a72,
    opacity: [0.46, 0.64],
    size: 0.82,
    depth: 0.055,
    ttl: [12, 17],
    sparkColor: [0xffc36a, 0xfff0ba],
    sparkCount: 12,
  },
  glass: {
    texture: 'chip',
    color: 0xb9eaff,
    opacity: [0.26, 0.42],
    size: 0.34,
    depth: 0.035,
    ttl: [8, 12],
    sparkColor: [0xcdefff, 0xffffff],
    sparkCount: 3,
  },
  flesh: {
    texture: 'wet',
    color: 0x210405,
    opacity: [0.62, 0.82],
    size: 0.74,
    depth: 0.045,
    ttl: [10, 15],
    sparkColor: [0x5a0b0b, 0x2a0505],
    sparkCount: 0,
  },
};

function randRange(range) {
  return range[0] + Math.random() * (range[1] - range[0]);
}

function createDecalTexture(kind) {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 96, 96);

  if (kind === 'chip') {
    const gradient = ctx.createRadialGradient(48, 48, 1, 48, 48, 30);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    gradient.addColorStop(0.22, 'rgba(205, 240, 255, 0.55)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 96, 96);
    ctx.strokeStyle = 'rgba(235, 255, 255, 0.42)';
    ctx.lineWidth = 1.25;
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2 + Math.random() * 0.32;
      const inner = 5 + Math.random() * 6;
      const outer = 14 + Math.random() * 18;
      ctx.beginPath();
      ctx.moveTo(48 + Math.cos(angle) * inner, 48 + Math.sin(angle) * inner);
      ctx.lineTo(48 + Math.cos(angle) * outer, 48 + Math.sin(angle) * outer);
      ctx.stroke();
    }
  } else if (kind === 'rim') {
    const gradient = ctx.createRadialGradient(48, 48, 3, 48, 48, 42);
    gradient.addColorStop(0, 'rgba(25, 17, 10, 0.9)');
    gradient.addColorStop(0.28, 'rgba(42, 29, 17, 0.7)');
    gradient.addColorStop(0.48, 'rgba(255, 197, 104, 0.52)');
    gradient.addColorStop(0.68, 'rgba(77, 50, 25, 0.28)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 96, 96);
  } else if (kind === 'wet') {
    const gradient = ctx.createRadialGradient(48, 48, 2, 48, 48, 36);
    gradient.addColorStop(0, 'rgba(36, 0, 1, 0.96)');
    gradient.addColorStop(0.5, 'rgba(24, 0, 1, 0.68)');
    gradient.addColorStop(0.82, 'rgba(9, 0, 0, 0.28)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 96, 96);
    ctx.fillStyle = 'rgba(80, 5, 5, 0.45)';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.ellipse(36 + Math.random() * 25, 40 + Math.random() * 22, 3 + Math.random() * 8, 1 + Math.random() * 4, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const gradient = ctx.createRadialGradient(48, 48, 4, 48, 48, 43);
    gradient.addColorStop(0, 'rgba(4, 3, 2, 0.96)');
    gradient.addColorStop(0.35, 'rgba(10, 7, 5, 0.78)');
    gradient.addColorStop(0.72, 'rgba(24, 18, 13, 0.34)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 96, 96);
  }

  ctx.fillStyle = kind === 'chip' ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.35)';
  const flecks = kind === 'chip' ? 4 : 10;
  for (let i = 0; i < flecks; i++) {
    const x = 32 + Math.random() * 32;
    const y = 32 + Math.random() * 32;
    ctx.beginPath();
    ctx.ellipse(x, y, 1 + Math.random() * 3, 0.5 + Math.random() * 2, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function randomTangentVelocity(normal, out) {
  out.set(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5);
  out.addScaledVector(normal, 1.8 + Math.random() * 2.5);
  return out;
}

function firstMaterial(material) {
  return Array.isArray(material) ? material.find(Boolean) ?? null : material ?? null;
}

function explicitSurface(source) {
  if (!source) return null;
  return source.userData?.surface ?? firstMaterial(source.material)?.userData?.surface ?? null;
}

function surfaceFromName(object, material) {
  const name = `${object?.name ?? ''} ${material?.name ?? ''}`.toLowerCase();
  if (/flesh|skin|blood/.test(name)) return 'flesh';
  if (/glass|screen|window|monitor/.test(name)) return 'glass';
  if (/metal|steel|iron|door|vent|rack|grate|latch|panel/.test(name) || (material?.metalness ?? 0) > 0.34) return 'metal';
  if (/concrete|cement|floor|wall|stone/.test(name)) return 'concrete';
  if (material?.isMeshPhysicalMaterial && (material.transmission > 0 || material.opacity < 0.55)) return 'glass';
  return 'concrete';
}

function surfaceFor(hit, object) {
  const material = firstMaterial(hit?.material) ?? firstMaterial(object?.material);
  const candidates = [hit, object];
  let current = object?.parent ?? null;
  while (current) {
    candidates.push(current);
    current = current.parent;
  }

  for (const candidate of candidates) {
    const value = explicitSurface(candidate);
    if (value && SURFACE_PRESETS[value]) return value;
  }

  return surfaceFromName(object, material);
}

function chooseSparkColor(colors) {
  if (!colors?.length) return 0xffc36a;
  return colors[Math.floor(Math.random() * colors.length)];
}

function parseSpawnArgs(hitOrPoint, normalOrOptions = {}, hitObject = null, extraOptions = {}) {
  if (hitOrPoint?.point?.isVector3 && hitOrPoint?.normal?.isVector3) {
    return {
      hit: hitOrPoint,
      point: hitOrPoint.point,
      normal: hitOrPoint.normal,
      object: hitOrPoint.object ?? null,
      options: normalOrOptions ?? {},
    };
  }

  if (hitOrPoint?.isVector3 && normalOrOptions?.isVector3) {
    return {
      hit: null,
      point: hitOrPoint,
      normal: normalOrOptions,
      object: hitObject?.object ?? hitObject,
      options: extraOptions ?? {},
    };
  }

  return null;
}

export class Decals {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.max = options.max ?? 80;
    this.cursor = 0;
    this.decalTtl = options.decalTtl ?? 14;
    this.decals = [];
    this.sparks = [];
    this.sparkPool = [];
    this.sparkCursor = 0;
    this.sparkPoolSize = options.sparkPoolSize ?? 36;
    this.sparkPointCount = options.sparkPointCount ?? 12;

    this.textures = {
      scorch: createDecalTexture('scorch'),
      rim: createDecalTexture('rim'),
      chip: createDecalTexture('chip'),
      wet: createDecalTexture('wet'),
    };

    this.planeGeometry = new THREE.PlaneGeometry(1, 1);
    this.projector = new ProjectedDecal({
      planeGeometry: this.planeGeometry,
      offset: options.offset ?? 0.014,
    });

    this.baseMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: this.textures.scorch,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      side: THREE.DoubleSide,
    });

    for (let i = 0; i < this.max; i++) {
      const decal = new THREE.Mesh(this.planeGeometry, this.baseMaterial.clone());
      decal.visible = false;
      decal.frustumCulled = false;
      decal.renderOrder = 2;
      decal.userData.isDecal = true;
      decal.userData.combatIgnore = true;
      decal.userData.age = 0;
      decal.userData.ttl = this.decalTtl;
      decal.userData.baseOpacity = this.baseMaterial.opacity;
      this.scene.add(decal);
      this.decals.push(decal);
    }

    for (let i = 0; i < this.sparkPoolSize; i++) {
      const positions = new Float32Array(this.sparkPointCount * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setDrawRange(0, 0);
      const material = new THREE.PointsMaterial({
        color: 0xffc36a,
        size: 0.035,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const points = new THREE.Points(geometry, material);
      points.visible = false;
      points.userData.isCombatVfx = true;
      points.userData.combatIgnore = true;
      this.scene.add(points);
      this.sparkPool.push({
        points,
        positions,
        velocities: Array.from({ length: this.sparkPointCount }, () => new THREE.Vector3()),
        age: 0,
        ttl: 0,
        count: 0,
        active: false,
      });
    }
  }

  spawn(hitOrPoint, normalOrOptions = {}, hitObject = null, extraOptions = {}) {
    const args = parseSpawnArgs(hitOrPoint, normalOrOptions, hitObject, extraOptions);
    if (!args?.point || !args?.normal) return null;

    _point.copy(args.point);
    _normal.copy(args.normal);
    if (_normal.lengthSq() < 0.0001) _normal.set(0, 1, 0);
    _normal.normalize();

    const target = args.object?.isMesh ? args.object : args.hit?.object ?? null;
    const surface = args.options.surface ?? surfaceFor(args.hit, target);
    const preset = SURFACE_PRESETS[surface] ?? SURFACE_PRESETS.concrete;
    const decal = this.decals[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;

    const baseSize = args.options.size ?? 0.105 + Math.random() * 0.055;
    const size = baseSize * preset.size * (0.88 + Math.random() * 0.24);
    const width = size * (0.76 + Math.random() * 0.42);
    const height = size * (0.78 + Math.random() * 0.38);
    const depth = args.options.depth ?? preset.depth;
    const rotation = args.options.rotation ?? Math.random() * Math.PI * 2;

    this.projector.apply(decal, {
      point: _point,
      normal: _normal,
      target,
      width,
      height,
      depth,
      rotation,
      offset: args.options.offset,
    });

    decal.material.map = this.textures[preset.texture] ?? this.textures.scorch;
    decal.material.color.setHex(args.options.color ?? preset.color);
    decal.material.needsUpdate = true;
    decal.userData.age = 0;
    decal.userData.ttl = args.options.ttl ?? randRange(preset.ttl);
    decal.userData.baseOpacity = args.options.opacity ?? randRange(preset.opacity);
    decal.userData.surface = surface;
    decal.material.opacity = decal.userData.baseOpacity;
    decal.visible = true;

    if (args.options.spark !== false && preset.sparkCount > 0) {
      this.spawnSpark(_point, _normal, {
        count: Math.min(args.options.sparkCount ?? preset.sparkCount, this.sparkPointCount),
        color: args.options.sparkColor ?? chooseSparkColor(preset.sparkColor),
      });
    }

    return decal;
  }

  spawnSpark(point, normal, options = {}) {
    const count = Math.min(options.count ?? 9, this.sparkPointCount);
    const spark = this.sparkPool[this.sparkCursor];
    this.sparkCursor = (this.sparkCursor + 1) % this.sparkPool.length;
    if (spark.active) {
      const index = this.sparks.indexOf(spark);
      if (index >= 0) this.sparks.splice(index, 1);
    }

    for (let i = 0; i < count; i++) {
      spark.positions[i * 3] = point.x;
      spark.positions[i * 3 + 1] = point.y;
      spark.positions[i * 3 + 2] = point.z;
      randomTangentVelocity(normal, spark.velocities[i]);
    }
    spark.points.geometry.attributes.position.needsUpdate = true;
    spark.points.geometry.setDrawRange(0, count);
    spark.points.material.color.setHex(options.color ?? (Math.random() > 0.35 ? 0xffc36a : 0xffe1a3));
    spark.points.material.size = options.size ?? 0.028 + Math.random() * 0.018;
    spark.points.material.opacity = 0.95;
    spark.points.visible = true;
    spark.age = 0;
    spark.ttl = options.ttl ?? 0.13 + Math.random() * 0.06;
    spark.count = count;
    spark.active = true;
    this.sparks.push(spark);
  }

  update(dt) {
    for (const decal of this.decals) {
      if (!decal.visible) continue;
      decal.userData.age += dt;
      const ttl = Math.max(0.001, decal.userData.ttl);
      if (decal.userData.age >= ttl) {
        decal.visible = false;
        this.projector.release(decal);
        continue;
      }

      const fadeStart = ttl * 0.58;
      const fade = decal.userData.age <= fadeStart ? 1 : 1 - (decal.userData.age - fadeStart) / (ttl - fadeStart);
      decal.material.opacity = decal.userData.baseOpacity * Math.max(0, fade);
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const spark = this.sparks[i];
      spark.age += dt;
      const life = 1 - spark.age / spark.ttl;
      if (life <= 0) {
        spark.points.visible = false;
        spark.points.geometry.setDrawRange(0, 0);
        spark.active = false;
        this.sparks.splice(i, 1);
        continue;
      }

      const positions = spark.points.geometry.attributes.position;
      for (let p = 0; p < spark.count; p++) {
        const velocity = spark.velocities[p];
        velocity.y -= 7.5 * dt;
        positions.array[p * 3] += velocity.x * dt;
        positions.array[p * 3 + 1] += velocity.y * dt;
        positions.array[p * 3 + 2] += velocity.z * dt;
      }
      positions.needsUpdate = true;
      spark.points.material.opacity = Math.max(0, life);
    }
  }

  dispose() {
    for (const decal of this.decals) {
      this.projector.release(decal);
      this.scene.remove(decal);
      decal.material.dispose();
    }
    for (const spark of this.sparkPool) {
      this.scene.remove(spark.points);
      spark.points.geometry.dispose();
      spark.points.material.dispose();
    }
    this.baseMaterial.dispose();
    this.planeGeometry.dispose();
    for (const texture of Object.values(this.textures)) texture?.dispose?.();
  }
}
