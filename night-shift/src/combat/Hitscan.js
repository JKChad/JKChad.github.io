import * as THREE from 'three';
import { CONFIG } from '../config.js';

export const HITSCAN_LAYERS = Object.freeze({
  world: 'world',
  enemies: 'enemies',
  lights: 'lights',
  player: 'player',
});

const DEFAULT_LAYERS = new Set([HITSCAN_LAYERS.world, HITSCAN_LAYERS.enemies, HITSCAN_LAYERS.lights]);
const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _fallbackUp = new THREE.Vector3(1, 0, 0);
const _normalMatrix = new THREE.Matrix3();

function vectorFrom(value, fallback, out) {
  if (value?.isVector3) return out.copy(value);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return out.set(value.x, value.y, value.z);
  }
  return out.copy(fallback);
}

function hasAncestorFlag(object, predicate) {
  let current = object;
  while (current) {
    if (predicate(current)) return true;
    current = current.parent;
  }
  return false;
}

export function getHitRoot(object, predicate) {
  let current = object;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return object;
}

export function isEnemyObject(object) {
  return hasAncestorFlag(
    object,
    (candidate) =>
      candidate.userData?.team === 'enemy' ||
      candidate.userData?.isGuard === true ||
      candidate.userData?.combatEnemy === true ||
      candidate.userData?.guard
  );
}

export function isPotentialLightObject(object) {
  return hasAncestorFlag(object, (candidate) => {
    const data = candidate.userData || {};
    const name = candidate.name || '';
    return (
      data.breakableLight === true ||
      data.lightId !== undefined ||
      data.breakableLightId !== undefined ||
      /(^|[_\-\s])(bulb|lamp|light|tube|fixture)([_\-\s]|$)/i.test(name)
    );
  });
}

export function isPlayerObject(object) {
  return hasAncestorFlag(object, (candidate) => candidate.userData?.isPlayer === true);
}

function nowSeconds() {
  if (typeof performance !== 'undefined' && performance.now) return performance.now() * 0.001;
  return Date.now() * 0.001;
}

export class Hitscan {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.maxDistance = options.maxDistance ?? 80;
    this.refreshInterval = options.refreshInterval ?? 0.25;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.near = 0.02;
    this.raycaster.far = this.maxDistance;
    this._candidates = [];
    this._candidateSet = new Set();
    this._intersections = [];
    this._registered = new Map();
    this._layerCandidates = new Map(Object.values(HITSCAN_LAYERS).map((layer) => [layer, []]));
    this._lastRefresh = -Infinity;
    this._candidateDirty = true;
    this._hitResult = {
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      object: null,
      distance: 0,
      direction: new THREE.Vector3(),
    };
  }

  fire(payload = {}, options = {}) {
    const origin = vectorFrom(payload.origin, new THREE.Vector3(), _origin);
    const direction = vectorFrom(payload.direction, new THREE.Vector3(0, 0, -1), _direction).normalize();
    const spread =
      payload.spread ??
      options.spread ??
      (payload.ads ? CONFIG.weapon.pelletSpreadAds : CONFIG.weapon.pelletSpreadHip);
    this._applySpread(direction, spread);

    const maxDistance = options.maxDistance ?? payload.maxDistance ?? this.maxDistance;
    const layers = options.layers ? new Set(options.layers) : DEFAULT_LAYERS;
    this.raycaster.far = maxDistance;
    this.raycaster.set(origin, direction);

    this._refreshCandidates(options.refreshCandidates === true);
    this._collectCandidates(layers);
    this._intersections.length = 0;
    const intersections = this.raycaster.intersectObjects(this._candidates, true, this._intersections);
    for (const intersection of intersections) {
      const object = intersection.object;
      if (!object || this._isIgnored(object)) continue;
      const hit = this._hitResult;
      hit.point.copy(intersection.point);
      this._normalFor(intersection, direction, hit.normal);
      hit.object = object;
      hit.distance = intersection.distance;
      hit.direction.copy(direction);
      return hit;
    }

    return null;
  }

  registerCandidate(object, layer = null) {
    if (!object) return object;
    this._registered.set(object, layer ?? object.userData?.combatLayer ?? HITSCAN_LAYERS.world);
    this.invalidateCandidates();
    return object;
  }

  unregisterCandidate(object) {
    if (!object) return;
    this._registered.delete(object);
    this.invalidateCandidates();
  }

  invalidateCandidates() {
    this._candidateDirty = true;
  }

  _applySpread(direction, spread) {
    if (!Number.isFinite(spread) || spread <= 0) return;

    _right.crossVectors(direction, Math.abs(direction.dot(_worldUp)) > 0.96 ? _fallbackUp : _worldUp).normalize();
    _up.crossVectors(_right, direction).normalize();

    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * spread;
    direction
      .addScaledVector(_right, Math.cos(angle) * radius)
      .addScaledVector(_up, Math.sin(angle) * radius)
      .normalize();
  }

  _collectCandidates(layers) {
    this._candidates.length = 0;
    this._candidateSet.clear();

    for (const layer of layers) {
      const list = this._layerCandidates.get(layer);
      if (!list) continue;
      for (const object of list) {
        if (!object || this._candidateSet.has(object) || this._isIgnored(object)) continue;
        this._candidateSet.add(object);
        this._candidates.push(object);
      }
    }
  }

  _refreshCandidates(force = false) {
    const now = nowSeconds();
    if (!force && !this._candidateDirty && now - this._lastRefresh < this.refreshInterval) return;

    for (const list of this._layerCandidates.values()) list.length = 0;
    const layerSets = new Map(Object.values(HITSCAN_LAYERS).map((layer) => [layer, new Set()]));

    this.scene.traverse((object) => {
      if (!this._isSceneCandidate(object)) return;
      const layer = this._layerFor(object);
      if (layer) layerSets.get(layer)?.add(object);
    });

    for (const [root, layer] of this._registered) {
      this._addRegisteredCandidate(root, layer, layerSets);
    }

    for (const [layer, set] of layerSets) {
      this._layerCandidates.get(layer).push(...set);
    }

    this._lastRefresh = now;
    this._candidateDirty = false;
  }

  _matchesLayers(object, layers) {
    const explicitLayer = object.userData?.combatLayer;
    if (explicitLayer && layers.has(explicitLayer)) return true;

    if (layers.has(HITSCAN_LAYERS.player) && isPlayerObject(object)) return true;
    if (layers.has(HITSCAN_LAYERS.enemies) && isEnemyObject(object)) return true;
    if (layers.has(HITSCAN_LAYERS.lights) && isPotentialLightObject(object)) return true;

    if (!layers.has(HITSCAN_LAYERS.world)) return false;
    return !isEnemyObject(object) && !isPotentialLightObject(object) && !isPlayerObject(object);
  }

  _layerFor(object) {
    const explicitLayer = object.userData?.combatLayer;
    if (explicitLayer && this._layerCandidates.has(explicitLayer)) return explicitLayer;
    if (isPlayerObject(object)) return HITSCAN_LAYERS.player;
    if (isEnemyObject(object)) return HITSCAN_LAYERS.enemies;
    if (isPotentialLightObject(object)) return HITSCAN_LAYERS.lights;
    return HITSCAN_LAYERS.world;
  }

  _addRegisteredCandidate(root, layer, layerSets) {
    const targetLayer = layerSets.has(layer) ? layer : this._layerFor(root);
    const add = (object) => {
      if (!object?.isMesh || this._isIgnored(object)) return;
      layerSets.get(targetLayer)?.add(object);
    };

    if (root.isMesh) add(root);
    root.traverse?.(add);
  }

  _isSceneCandidate(object) {
    return object.isMesh && object.visible && !this._isIgnored(object);
  }

  _isIgnored(object) {
    return hasAncestorFlag(
      object,
      (candidate) =>
        candidate.userData?.combatIgnore === true ||
        candidate.userData?.isDecal === true ||
        candidate.userData?.isCombatVfx === true
    );
  }

  _normalFor(intersection, direction, out = _normal) {
    if (intersection.face) {
      _normalMatrix.getNormalMatrix(intersection.object.matrixWorld);
      out.copy(intersection.face.normal).applyNormalMatrix(_normalMatrix).normalize();
    } else {
      out.copy(direction).multiplyScalar(-1).normalize();
    }

    if (out.dot(direction) > 0) out.multiplyScalar(-1);
    return out;
  }
}
