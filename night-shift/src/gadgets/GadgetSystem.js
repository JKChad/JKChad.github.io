import * as THREE from 'three';
import { GADGET_IDS, getGadgetDef } from '../core/combat/Loadout.js';

const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function vectorFrom(value, fallback, out) {
  if (value?.isVector3) return out.copy(value);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return out.set(value.x, value.y, value.z);
  }
  return out.copy(fallback);
}

function controllerFor(root) {
  let cursor = root;
  while (cursor) {
    if (cursor.userData?.guard) return cursor.userData.guard;
    cursor = cursor.parent;
  }
  return null;
}

export class GadgetSystem {
  constructor(scene, bus, audio, lights, combat) {
    this.scene = scene;
    this.bus = bus;
    this.audio = audio;
    this.lights = lights;
    this.combat = combat;
    this.effects = [];
  }

  use(payload = {}) {
    const gadget = getGadgetDef(payload.gadgetId);
    vectorFrom(payload.origin, new THREE.Vector3(), _origin);
    vectorFrom(payload.direction, new THREE.Vector3(0, 0, -1), _direction).normalize();
    if (_direction.lengthSq() < 0.001) _direction.set(0, 0, -1);

    if (gadget.id === GADGET_IDS.flashbang) {
      return this._useFlashbang(gadget, _origin, _direction);
    }
    if (gadget.id === GADGET_IDS.emp) {
      return this._useEmp(gadget, _origin);
    }
    if (gadget.id === GADGET_IDS.taser) {
      return this._useTaser(gadget, _origin, _direction);
    }
    return { ok: false, reason: 'unknown-gadget' };
  }

  update(dt) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      effect.age += dt;
      const life = 1 - effect.age / effect.ttl;
      if (life <= 0) {
        this.scene.remove(effect.mesh);
        effect.mesh.geometry?.dispose?.();
        effect.mesh.material?.dispose?.();
        this.effects.splice(i, 1);
        continue;
      }
      effect.mesh.scale.setScalar(effect.baseScale * (1 + effect.expand * (1 - life)));
      effect.mesh.material.opacity = effect.opacity * life;
    }
  }

  _useFlashbang(gadget, origin, direction) {
    const targets = this._targetsInCone(origin, direction, gadget.range, gadget.coneDeg);
    for (const target of targets) {
      this.combat?.stunEnemy?.(target.root, gadget.stunSeconds, { source: gadget.id });
      if (target.controller) {
        target.controller.combatShotTimer = Math.max(target.controller.combatShotTimer ?? 0, gadget.stunSeconds);
      }
    }

    this.bus?.emit?.('gadget:attentionSpike', {
      gadget: gadget.id,
      amount: gadget.attentionSpike,
      origin: origin.clone(),
      radius: gadget.range,
    });
    this.bus?.emit?.('noise', { kind: 'flashbang', position: origin.clone(), ttl: 1.5 });
    this.audio?.play?.('alarm');
    this._spawnPulse(origin, 0xcfe8ff, 0.82, 0.75);
    return { ok: true, affected: targets.length };
  }

  _useEmp(gadget, origin) {
    let broken = 0;
    const lights = this._lightEntries();
    for (const record of lights) {
      if (!record?.alive || !record.position) continue;
      const position = vectorFrom(record.position, origin, _targetPos);
      if (position.distanceTo(origin) > gadget.radius) continue;
      if (this.lights?.breakLight?.(record.id)) broken += 1;
      else if (this.lights?.breakAt?.(position)) broken += 1;
    }
    if (broken === 0) this.lights?.breakAt?.(origin);

    const targets = this._targetsInRadius(origin, gadget.radius);
    let disabledTechs = 0;
    for (const target of targets) {
      if (target.type !== 'tech') {
        this.combat?.stunEnemy?.(target.root, gadget.stunSeconds, { source: gadget.id });
        continue;
      }
      disabledTechs += 1;
      this.combat?.damageEnemyDirect?.(target.root, gadget.techDamage, {
        source: gadget.id,
        direction: _direction.set(0, 0, -1).clone(),
      });
      this.combat?.stunEnemy?.(target.root, gadget.stunSeconds * 1.4, { source: gadget.id });
    }

    this.bus?.emit?.('gadget:attentionSpike', {
      gadget: gadget.id,
      amount: gadget.attentionSpike,
      origin: origin.clone(),
      radius: gadget.radius,
    });
    this.bus?.emit?.('noise', { kind: 'emp', position: origin.clone(), ttl: 1.2 });
    this.audio?.play?.('glass');
    this._spawnPulse(origin, 0x66fff0, 0.52, 1.0);
    return { ok: true, broken, disabledTechs };
  }

  _useTaser(gadget, origin, direction) {
    const target = this._targetsInCone(origin, direction, gadget.range, gadget.coneDeg)[0] ?? null;
    if (!target) {
      this.bus?.emit?.('gadget:attentionSpike', {
        gadget: gadget.id,
        amount: Math.round(gadget.attentionSpike * 0.35),
        origin: origin.clone(),
        radius: gadget.range,
      });
      this._spawnTaserArc(origin, direction, gadget.range * 0.65, false);
      return { ok: false, reason: 'no-target' };
    }

    this.combat?.incapacitateEnemy?.(target.root, {
      source: gadget.id,
      seconds: gadget.incapacitateSeconds,
      controller: target.controller,
    });
    this.bus?.emit?.('gadget:attentionSpike', {
      gadget: gadget.id,
      amount: gadget.attentionSpike,
      origin: origin.clone(),
      radius: gadget.range,
    });
    this.bus?.emit?.('noise', { kind: 'taser', position: origin.clone(), ttl: 1.0 });
    this.audio?.play?.('hit');
    this._spawnTaserArc(origin, direction, target.distance, true);
    return { ok: true, target: target.root };
  }

  _targetsInCone(origin, direction, range, coneDeg) {
    const minDot = Math.cos(THREE.MathUtils.degToRad(coneDeg) * 0.5);
    return this._collectTargets()
      .map((target) => {
        this._targetPosition(target, _targetPos);
        _toTarget.subVectors(_targetPos, origin);
        const distance = _toTarget.length();
        if (distance <= 0.001 || distance > range) return null;
        const dot = _toTarget.multiplyScalar(1 / distance).dot(direction);
        if (dot < minDot) return null;
        return { ...target, distance, dot };
      })
      .filter(Boolean)
      .sort((a, b) => b.dot - a.dot || a.distance - b.distance);
  }

  _targetsInRadius(origin, radius) {
    return this._collectTargets()
      .map((target) => {
        this._targetPosition(target, _targetPos);
        const distance = _targetPos.distanceTo(origin);
        if (distance > radius) return null;
        return { ...target, distance };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance);
  }

  _collectTargets() {
    const targets = [];
    const seen = new Set();
    const add = (root, entry = null) => {
      if (!root || seen.has(root) || root.userData?.dead || root.userData?.incapacitated) return;
      seen.add(root);
      const controller = controllerFor(root);
      if (controller && (controller.alive === false || controller.state === 'dead' || controller.state === 'incapacitated')) return;
      targets.push({
        root,
        entry,
        controller,
        type: root.userData?.enemyType ?? entry?.type ?? controller?.enemyType ?? 'guard',
      });
    };

    for (const entry of this.combat?.enemies ?? []) {
      if (entry?.alive !== false) add(entry.root, entry);
    }

    this.scene?.traverse?.((object) => {
      const data = object.userData ?? {};
      if (data.guard || data.combatEnemy || data.team === 'enemy' || data.isGuard) add(data.hitRoot ?? object, null);
    });

    return targets;
  }

  _targetPosition(target, out) {
    if (target.controller?.getEyePosition) return target.controller.getEyePosition(out);
    if (target.root?.getWorldPosition) return target.root.getWorldPosition(out).addScaledVector(_up, 1.0);
    return out.set(0, 1, 0);
  }

  _lightEntries() {
    const source = this.lights?.list ?? [];
    if (Array.isArray(source)) return source;
    if (source instanceof Map) return Array.from(source.values());
    if (typeof source === 'object') return Object.values(source);
    return [];
  }

  _spawnPulse(origin, color, opacity, expand) {
    const geometry = new THREE.SphereGeometry(1, 24, 12);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(origin);
    mesh.userData.isCombatVfx = true;
    mesh.userData.combatIgnore = true;
    this.scene.add(mesh);
    this.effects.push({ mesh, age: 0, ttl: 0.42, baseScale: 0.18, expand: expand * 12, opacity });
  }

  _spawnTaserArc(origin, direction, distance, hit) {
    const geometry = new THREE.BufferGeometry();
    const end = origin.clone().addScaledVector(direction, Math.max(0.4, distance));
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([origin.x, origin.y, origin.z, end.x, end.y, end.z]), 3)
    );
    const material = new THREE.LineBasicMaterial({
      color: hit ? 0x9ffff5 : 0x467a86,
      transparent: true,
      opacity: hit ? 0.9 : 0.45,
      depthWrite: false,
    });
    const mesh = new THREE.Line(geometry, material);
    mesh.userData.isCombatVfx = true;
    mesh.userData.combatIgnore = true;
    this.scene.add(mesh);
    this.effects.push({ mesh, age: 0, ttl: 0.16, baseScale: 1, expand: 0, opacity: material.opacity });
  }
}
