import * as THREE from 'three';

const LIGHT_NAME_RE = /(^|[_\-\s])(bulb|lamp|light|tube|fixture)([_\-\s]|$)/i;
const _point = new THREE.Vector3();
const _normal = new THREE.Vector3(0, 1, 0);

function asVector3(value, fallback = new THREE.Vector3()) {
  if (value?.isVector3) return value;
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return new THREE.Vector3(value.x, value.y, value.z);
  }
  return fallback;
}

function entryCandidates(entry) {
  if (!entry || typeof entry !== 'object') return [];
  return [entry.object, entry.mesh, entry.group, entry.fixture, entry.bulb, entry.light].filter(Boolean);
}

function isAncestorOrSelf(object, possibleAncestor) {
  let current = object;
  while (current) {
    if (current === possibleAncestor) return true;
    current = current.parent;
  }
  return false;
}

export class BreakableLights {
  constructor(scene, bus, audio, lights, options = {}) {
    this.scene = scene;
    this.bus = bus;
    this.audio = audio;
    this.lights = lights;
    this.broken = new Set();
    this.shards = [];
    this.shardGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.shardTtl = options.shardTtl ?? 1.15;
    this._breakEventSerial = 0;

    this.bus?.on?.('light:broken', ({ id } = {}) => {
      this._breakEventSerial++;
      if (id !== undefined && id !== null) this.broken.add(String(id));
    });
  }

  isBreakableObject(object) {
    return Boolean(this._findBreakableRoot(object) || this._registeredLightForObject(object));
  }

  breakFromHit(hit) {
    const target = this.resolveFromHit(hit);
    if (!target) return false;
    return this.breakLight(target, target.point, target.normal);
  }

  resolveFromHit(hit) {
    if (!hit?.object) return null;

    const point = asVector3(hit.point, _point).clone();
    const normal = asVector3(hit.normal, _normal).clone().normalize();
    const root = this._findBreakableRoot(hit.object);
    if (root) {
      return {
        object: root,
        id: this._idFor(root),
        point,
        normal,
      };
    }

    const registered = this._registeredLightForObject(hit.object) || this._registeredLightNear(point);
    if (!registered) return null;
    return {
      object: registered.object,
      entry: registered.entry,
      id: this._idFor(registered.object, registered.entry),
      point,
      normal,
    };
  }

  breakLight(target, point = null, normal = null) {
    const object = target?.object ?? target;
    const entry = target?.entry;
    const id = target?.id ?? this._idFor(object, entry);
    const key = id !== undefined && id !== null ? String(id) : object?.uuid;
    if (!key) return false;
    if (this.broken.has(key)) return true;

    this.broken.add(key);
    if (object?.userData) {
      object.userData.broken = true;
      object.userData.breakableLightBroken = true;
    }

    const impactPoint = point?.isVector3 ? point.clone() : this._positionFor(object, entry);
    const impactNormal = normal?.isVector3 ? normal.clone().normalize() : new THREE.Vector3(0, -1, 0);

    const eventsBeforeLightSystem = this._breakEventSerial;
    this._disableLocalLight(object, entry);
    this._notifyLightSystem(id, object, impactPoint);
    this._spawnShatter(impactPoint, impactNormal);
    this.audio?.play?.('glass');
    if (this._breakEventSerial === eventsBeforeLightSystem) this.bus?.emit?.('light:broken', { id: key });
    return true;
  }

  update(dt) {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const shard = this.shards[i];
      shard.age += dt;
      if (shard.age >= shard.ttl) {
        this.scene.remove(shard.mesh);
        shard.mesh.material.dispose();
        this.shards.splice(i, 1);
        continue;
      }

      shard.velocity.y -= 8.4 * dt;
      shard.mesh.position.addScaledVector(shard.velocity, dt);
      shard.mesh.rotation.x += shard.spin.x * dt;
      shard.mesh.rotation.y += shard.spin.y * dt;
      shard.mesh.rotation.z += shard.spin.z * dt;
      shard.mesh.material.opacity = Math.max(0, 1 - shard.age / shard.ttl);
    }
  }

  _findBreakableRoot(object) {
    let current = object;
    let namedMatch = null;
    while (current) {
      const data = current.userData || {};
      if (data.breakableLight === true || data.breakableLightId !== undefined || data.lightId !== undefined) return current;
      if (!namedMatch && LIGHT_NAME_RE.test(current.name || '')) namedMatch = current;
      current = current.parent;
    }
    return namedMatch;
  }

  _registeredLightForObject(object) {
    for (const entry of this._lightEntries()) {
      for (const candidate of entryCandidates(entry)) {
        if (candidate === object || isAncestorOrSelf(object, candidate) || isAncestorOrSelf(candidate, object)) {
          return { entry, object: candidate };
        }
      }
    }
    return null;
  }

  _registeredLightNear(point) {
    let best = null;
    let bestDistance = Infinity;
    for (const entry of this._lightEntries()) {
      const position = this._positionFor(null, entry);
      const distance = position.distanceTo(point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { entry, object: entryCandidates(entry)[0] ?? null };
      }
    }
    return bestDistance <= 0.75 ? best : null;
  }

  _lightEntries() {
    const source = this.lights?.list ?? this.lights?.lights ?? this.lights?.items;
    if (!source) return [];
    if (typeof source === 'function') return Array.from(source.call(this.lights) || []);
    if (Array.isArray(source)) return source;
    if (source instanceof Map) return Array.from(source.values());
    if (typeof source === 'object') return Object.values(source);
    return [];
  }

  _idFor(object, entry = null) {
    const data = object?.userData || {};
    return (
      data.breakableLightId ??
      data.lightId ??
      data.id ??
      entry?.id ??
      entry?.lightId ??
      entry?.name ??
      object?.name ??
      object?.uuid
    );
  }

  _positionFor(object, entry = null) {
    const out = new THREE.Vector3();
    const candidate = object ?? entryCandidates(entry)[0];
    if (candidate?.getWorldPosition) return candidate.getWorldPosition(out);
    if (entry?.position) return asVector3(entry.position, out).clone();
    return out;
  }

  _disableLocalLight(object, entry = null) {
    const seen = new Set();
    const darken = (candidate) => {
      if (!candidate || seen.has(candidate)) return;
      seen.add(candidate);
      if (candidate.isLight) {
        candidate.userData.originalIntensity ??= candidate.intensity;
        candidate.intensity = 0;
        candidate.visible = false;
      }
      if (candidate.isMesh && candidate.material) {
        const materials = Array.isArray(candidate.material) ? candidate.material : [candidate.material];
        candidate.material = Array.isArray(candidate.material)
          ? materials.map((material) => material.clone())
          : candidate.material.clone();
        const clonedMaterials = Array.isArray(candidate.material) ? candidate.material : [candidate.material];
        for (const material of clonedMaterials) {
          if (material.emissive) material.emissive.setHex(0x050505);
          if ('emissiveIntensity' in material) material.emissiveIntensity = 0;
          if (material.color) material.color.multiplyScalar(0.28);
        }
      }
    };

    object?.traverse?.(darken);
    darken(object);
    for (const candidate of entryCandidates(entry)) {
      candidate?.traverse?.(darken);
      darken(candidate);
    }
  }

  _notifyLightSystem(id, object, point) {
    if (!this.lights) return;

    const tryCall = (name, arg) => {
      if (typeof this.lights[name] !== 'function') return false;
      try {
        this.lights[name](arg);
        return true;
      } catch (err) {
        console.warn(`LightSystem.${name} failed while breaking light`, err);
        return false;
      }
    };

    if (id !== undefined && id !== null && tryCall('breakLight', id)) return;
    if (object && tryCall('breakLight', object)) return;
    if (point && tryCall('breakAt', point)) return;
    if (point && tryCall('breakAtPosition', point)) return;
    if (id !== undefined && id !== null && tryCall('disableLight', id)) return;
    if (id !== undefined && id !== null && tryCall('turnOffLight', id)) return;
    if (id !== undefined && id !== null) tryCall('setLightBroken', id);
  }

  _spawnShatter(point, normal) {
    const shardCount = 16;
    for (let i = 0; i < shardCount; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xb9d4ff,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.shardGeometry, material);
      const scale = 0.018 + Math.random() * 0.035;
      mesh.scale.set(scale * (0.6 + Math.random()), scale * (0.3 + Math.random()), scale * (0.6 + Math.random()));
      mesh.position.copy(point).addScaledVector(normal, 0.04);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      mesh.userData.isCombatVfx = true;
      mesh.userData.combatIgnore = true;
      this.scene.add(mesh);

      const velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5);
      velocity.addScaledVector(normal, 1.2 + Math.random() * 2.2);
      this.shards.push({
        mesh,
        velocity,
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14
        ),
        age: 0,
        ttl: this.shardTtl + Math.random() * 0.35,
      });
    }
  }
}
