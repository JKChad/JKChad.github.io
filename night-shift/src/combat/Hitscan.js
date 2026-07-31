import * as THREE from 'three';
import { CONFIG } from '../config.js';

export const HITSCAN_LAYERS = Object.freeze({
  world: 'world',
  enemies: 'enemies',
  lights: 'lights',
});

const DEFAULT_LAYERS = new Set(Object.values(HITSCAN_LAYERS));
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

export class Hitscan {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.maxDistance = options.maxDistance ?? 80;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.near = 0.02;
    this.raycaster.far = this.maxDistance;
    this._candidates = [];
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

    this.scene.updateMatrixWorld?.(true);
    this._collectCandidates(layers);
    const intersections = this.raycaster.intersectObjects(this._candidates, true);
    for (const intersection of intersections) {
      const object = intersection.object;
      if (!object || this._isIgnored(object)) continue;
      const normal = this._normalFor(intersection, direction);
      return {
        point: intersection.point.clone(),
        normal,
        object,
        distance: intersection.distance,
        direction: direction.clone(),
      };
    }

    return null;
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
    this.scene.traverse((object) => {
      if (!object.isMesh || !object.visible || this._isIgnored(object)) return;
      if (!this._matchesLayers(object, layers)) return;
      this._candidates.push(object);
    });
  }

  _matchesLayers(object, layers) {
    const explicitLayer = object.userData?.combatLayer;
    if (explicitLayer && layers.has(explicitLayer)) return true;

    if (layers.has(HITSCAN_LAYERS.enemies) && isEnemyObject(object)) return true;
    if (layers.has(HITSCAN_LAYERS.lights) && isPotentialLightObject(object)) return true;

    if (!layers.has(HITSCAN_LAYERS.world)) return false;
    return !isEnemyObject(object) && !isPotentialLightObject(object);
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

  _normalFor(intersection, direction) {
    if (intersection.face) {
      _normalMatrix.getNormalMatrix(intersection.object.matrixWorld);
      _normal.copy(intersection.face.normal).applyNormalMatrix(_normalMatrix).normalize();
    } else {
      _normal.copy(direction).multiplyScalar(-1).normalize();
    }

    if (_normal.dot(direction) > 0) _normal.multiplyScalar(-1);
    return _normal.clone();
  }
}
