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

function randomTangentVelocity(normal) {
  const tangent = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5);
  tangent.addScaledVector(normal, 1.8 + Math.random() * 2.5);
  return tangent;
}

export class Decals {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.max = options.max ?? 80;
    this.cursor = 0;
    this.decals = [];
    this.sparks = [];

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
      const decal = new THREE.Mesh(this.geometry, this.material);
      decal.visible = false;
      decal.renderOrder = 2;
      decal.userData.isDecal = true;
      decal.userData.combatIgnore = true;
      this.scene.add(decal);
      this.decals.push(decal);
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
    decal.scale.set(size * (0.75 + Math.random() * 0.35), size * (0.75 + Math.random() * 0.35), 1);
    decal.visible = true;

    if (options.spark !== false) this.spawnSpark(_point, _normal);
    return decal;
  }

  spawnSpark(point, normal, options = {}) {
    const count = options.count ?? 9;
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = point.x;
      positions[i * 3 + 1] = point.y;
      positions[i * 3 + 2] = point.z;
      velocities.push(randomTangentVelocity(normal));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: options.color ?? 0xffc36a,
      size: options.size ?? 0.035,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.userData.isCombatVfx = true;
    points.userData.combatIgnore = true;
    this.scene.add(points);

    this.sparks.push({
      points,
      velocities,
      age: 0,
      ttl: options.ttl ?? 0.16,
    });
  }

  update(dt) {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const spark = this.sparks[i];
      spark.age += dt;
      const life = 1 - spark.age / spark.ttl;
      if (life <= 0) {
        this.scene.remove(spark.points);
        spark.points.geometry.dispose();
        spark.points.material.dispose();
        this.sparks.splice(i, 1);
        continue;
      }

      const positions = spark.points.geometry.attributes.position;
      for (let p = 0; p < spark.velocities.length; p++) {
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
}
