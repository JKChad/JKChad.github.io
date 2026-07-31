import * as THREE from 'three';

const _zAxis = new THREE.Vector3(0, 0, 1);
const _point = new THREE.Vector3();
const _normal = new THREE.Vector3();

function createBulletMarkTexture() {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  gradient.addColorStop(0, 'rgba(5, 4, 3, 0.95)');
  gradient.addColorStop(0.42, 'rgba(12, 9, 7, 0.72)');
  gradient.addColorStop(0.72, 'rgba(24, 19, 16, 0.32)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  // A few asymmetric flecks keep repeated pooled decals from reading as stamps.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  for (let i = 0; i < 9; i++) {
    const x = 20 + Math.random() * 24;
    const y = 20 + Math.random() * 24;
    ctx.beginPath();
    ctx.ellipse(x, y, 1 + Math.random() * 3, 0.5 + Math.random() * 2, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function randomTangentVelocity(normal, out) {
  out.set(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5);
  out.addScaledVector(normal, 1.8 + Math.random() * 2.5);
  return out;
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

    const map = createBulletMarkTexture();
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.MeshBasicMaterial({
      color: 0x15100c,
      map,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      side: THREE.DoubleSide,
    });

    for (let i = 0; i < this.max; i++) {
      const decal = new THREE.Mesh(this.geometry, this.material.clone());
      decal.visible = false;
      decal.renderOrder = 2;
      decal.userData.isDecal = true;
      decal.userData.combatIgnore = true;
      decal.userData.age = 0;
      decal.userData.ttl = this.decalTtl;
      decal.userData.baseOpacity = this.material.opacity;
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

  spawn(hit, options = {}) {
    if (!hit?.point || !hit?.normal) return null;

    _point.copy(hit.point);
    _normal.copy(hit.normal).normalize();
    const decal = this.decals[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;

    const size = options.size ?? 0.105 + Math.random() * 0.055;
    decal.position.copy(_point).addScaledVector(_normal, options.offset ?? 0.014);
    decal.quaternion.setFromUnitVectors(_zAxis, _normal);
    decal.rotateZ(Math.random() * Math.PI * 2);
    decal.scale.set(size * (0.7 + Math.random() * 0.45), size * (0.72 + Math.random() * 0.42), 1);
    const shade = 0.82 + Math.random() * 0.32;
    decal.material.color.setRGB(0.082 * shade, 0.063 * shade, 0.047 * shade);
    decal.userData.age = 0;
    decal.userData.ttl = options.ttl ?? this.decalTtl + Math.random() * 5;
    decal.userData.baseOpacity = options.opacity ?? 0.58 + Math.random() * 0.22;
    decal.material.opacity = decal.userData.baseOpacity;
    decal.visible = true;

    if (options.spark !== false) this.spawnSpark(_point, _normal);
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
      this.scene.remove(decal);
      decal.material.dispose();
    }
    for (const spark of this.sparkPool) {
      this.scene.remove(spark.points);
      spark.points.geometry.dispose();
      spark.points.material.dispose();
    }
    const map = this.material.map;
    this.material.dispose();
    this.geometry.dispose();
    map?.dispose?.();
  }
}
