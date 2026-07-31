import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, smoothstep } from '../utils/math.js';

const PLAYER_EYE_OFFSET = 1.1;
const _eye = new THREE.Vector3();
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _flatDir = new THREE.Vector3();
const _lightDir = new THREE.Vector3();
const _beamDir = new THREE.Vector3();

export class PerceptionSystem {
  constructor(scene, bus, lights, attention, modes) {
    this.scene = scene;
    this.bus = bus;
    this.lights = lights;
    this.attention = attention;
    this.modes = modes;
    this.raycaster = new THREE.Raycaster();
    this.noises = [];
    this._spottedLatched = false;
    this._hadVisualContact = false;
    this._occluderSource = null;
    this._occluderSourceLength = -1;
    this._cachedOccluders = null;

    this.bus?.on('noise', (payload) => this.reportNoise(payload));
    this.bus?.on('player:noise', (payload) => this.reportNoise(payload));
    this.bus?.on('player:distract', (payload) => this.reportNoise(payload));
    this.bus?.on('weapon:fired', (payload) => this.reportNoise({ ...payload, kind: 'shot' }));
  }

  update(dt, player, partner, guard) {
    if (!guard?.alive || guard.state === 'dead') return;

    const heard = this._applyHearing(dt, player, guard);
    const best = this._scanTargets(player, partner, guard);

    if (best.score > 0.01) {
      guard.suspicion += best.score * CONFIG.guard.suspicionRise * dt;
      guard.noticeVisual?.(best.position, best.score);
      this._hadVisualContact = true;
    } else if (this._hadVisualContact) {
      guard.loseVisual?.();
      this._hadVisualContact = false;
    }

    if (best.score <= 0.01 && !heard && guard.state !== 'combat') {
      guard.suspicion -= CONFIG.guard.suspicionDecay * dt;
    }

    guard.suspicion = clamp(guard.suspicion, 0, CONFIG.guard.alarmThreshold);

    const stealth = this.modes?.isStealth ?? this.modes?.mode === 'stealth';
    if (stealth && guard.suspicion >= CONFIG.guard.alarmThreshold && !this._spottedLatched) {
      this._spottedLatched = true;
      this.bus?.emit('guard:spotted', {
        guard,
        target: best.target?.entity ?? player,
        targetType: best.target?.type ?? 'player',
        suspicion: guard.suspicion,
        score: best.score,
        illumination: best.illumination,
        visibility: best.visibility,
        flashlight: best.flashlight,
      });
    }

    if (!stealth || guard.suspicion < CONFIG.guard.alarmThreshold * 0.8) {
      this._spottedLatched = false;
    }
  }

  reportNoise(payload = {}) {
    const position = payload.position ?? payload.origin ?? payload.worldPosition ?? null;
    this.noises.push({
      position: position?.clone?.() ?? position,
      kind: payload.kind ?? 'noise',
      ttl: payload.ttl ?? 2.5,
      applied: false,
    });
  }

  _scanTargets(player, partner, guard) {
    const targets = [
      this._makeTarget('player', player, this.attention?.localVisibility ?? 1),
      this._makeTarget('partner', partner, this.attention?.partnerVisibility ?? 1),
    ].filter(Boolean);

    let best = {
      score: 0,
      target: null,
      position: null,
      illumination: 0,
      flashlight: 0,
      visibility: 0,
    };

    for (const target of targets) {
      const result = this._evaluateTarget(target, guard);
      if (result.score > best.score) {
        best = { ...result, target };
      }
    }

    return best;
  }

  _evaluateTarget(target, guard) {
    const eye = guard.getEyePosition?.(_eye) ?? _eye.copy(guard.position).add(new THREE.Vector3(0, 1.65, 0));
    const targetPoint = target.point;

    _dir.subVectors(targetPoint, eye);
    const distance = _dir.length();
    const flashlightRange = guard.flashlightRange ?? 12;
    const maxDistance = Math.max(CONFIG.guard.viewDistance, flashlightRange);
    if (distance <= 0.001 || distance > maxDistance) {
      return this._emptyResult(targetPoint, target.visibility);
    }

    _beamDir.copy(_dir).normalize();
    _flatDir.copy(_dir);
    _flatDir.y = 0;
    if (_flatDir.lengthSq() <= 0.0001) return this._emptyResult(targetPoint, target.visibility);
    _flatDir.normalize();

    const halfFov = THREE.MathUtils.degToRad(CONFIG.guard.fovDeg * 0.5);
    const fovDotThreshold = Math.cos(halfFov);
    const dot = clamp(guard.forward.dot(_flatDir), -1, 1);
    const inViewCone = distance <= CONFIG.guard.viewDistance && dot >= fovDotThreshold;

    const flashlightHalfFov = guard.flashlightFov ?? Math.PI / 7;
    const flashlightDotThreshold = Math.cos(flashlightHalfFov);
    const flashlightDot = clamp(guard.forward.dot(_beamDir), -1, 1);
    const inFlashlightCone = distance <= flashlightRange && flashlightDot >= flashlightDotThreshold;
    if (!inViewCone && !inFlashlightCone) return this._emptyResult(targetPoint, target.visibility);

    if (!this._hasLineOfSight(eye, targetPoint, distance, [guard.mesh, target.root])) {
      return this._emptyResult(targetPoint, target.visibility);
    }

    const illumination = this._sampleIllumination(targetPoint);
    const attentionVis = clamp(target.visibility, 0, 1);
    let flashlight = 0;
    if (inFlashlightCone) {
      const beamAngleFalloff = smoothstep(flashlightDotThreshold, 1, flashlightDot);
      const beamDistanceFalloff = 1 - smoothstep(flashlightRange * 0.45, flashlightRange, distance);
      flashlight = clamp(beamAngleFalloff * beamDistanceFalloff, 0, 1);
    }

    const visibility = (distance <= 2.5 || flashlight > 0.55)
      ? Math.max(attentionVis, 0.22)
      : attentionVis;

    let roomScore = 0;
    if (inViewCone) {
      const lightTerm = smoothstep(CONFIG.guard.lightThreshold, 1, illumination);
      const distanceFalloff = 1 - smoothstep(CONFIG.guard.viewDistance * 0.35, CONFIG.guard.viewDistance, distance);
      const fovFalloff = smoothstep(fovDotThreshold, 1, dot);
      roomScore = visibility * lightTerm * distanceFalloff * fovFalloff;
    }

    const flashlightScore = inFlashlightCone ? visibility * flashlight * 0.95 : 0;
    const combinedIllumination = clamp(illumination + flashlight * 0.85, 0, 1);
    let score = clamp(roomScore + flashlightScore, 0, 1);

    if (visibility < 0.2) {
      const veryCloseAndBright = distance < 2.25 && combinedIllumination > 0.86;
      const caughtInBeam = distance < flashlightRange * 0.55 && flashlight > 0.65;
      score *= veryCloseAndBright ? 0.55 : 0.08;
      if (caughtInBeam) score = Math.max(score, visibility * flashlight * 0.28);
    }

    return {
      score: clamp(score, 0, 1),
      position: targetPoint.clone(),
      illumination: combinedIllumination,
      ambientIllumination: illumination,
      flashlight,
      visibility,
    };
  }

  _applyHearing(dt, player, guard) {
    let heard = false;

    for (const noise of this.noises) {
      noise.ttl -= dt;
      if (noise.applied || noise.ttl <= 0) continue;

      const position = this._noisePosition(noise, player);
      if (!position) continue;

      const radius = this._hearingRadius(noise.kind);
      const distance = guard.position.distanceTo(position);
      if (distance > radius) continue;

      const strength = 1 - distance / Math.max(radius, 0.001);
      guard.suspicion += strength * (noise.kind === 'shot' ? 0.9 : 0.35);
      guard.hearNoise?.(position, noise.kind);
      noise.applied = true;
      heard = true;
    }

    this.noises = this.noises.filter((noise) => noise.ttl > 0 && !noise.applied);
    return heard;
  }

  _noisePosition(noise, player) {
    if (noise.position?.isVector3) return noise.position;
    if (noise.position) return toVector3(noise.position, new THREE.Vector3());

    const fallback = entityBasePosition(player, new THREE.Vector3());
    if (fallback) {
      noise.position = fallback.clone();
      return noise.position;
    }
    return null;
  }

  _hearingRadius(kind) {
    return kind === 'shot' || kind === 'explosion' || kind === 'alarm'
      ? CONFIG.guard.hearingRadiusLoud
      : CONFIG.guard.hearingRadiusQuiet;
  }

  _makeTarget(type, entity, visibility) {
    if (!entity || entity.alive === false || entity.dead === true) return null;

    const base = entityBasePosition(entity, new THREE.Vector3());
    if (!base) return null;

    const point = new THREE.Vector3();
    if (entity.camera?.getWorldPosition) {
      entity.camera.getWorldPosition(point);
    } else {
      point.copy(base);
      if (point.y < PLAYER_EYE_OFFSET) point.y += PLAYER_EYE_OFFSET;
    }
    const root = entity.mesh ?? entity.object ?? entity.group ?? entity.camera ?? null;

    return { type, entity, point, root, visibility };
  }

  _hasLineOfSight(origin, target, distance, excludedRoots = []) {
    if (!this.scene) return true;

    _dir.subVectors(target, origin).normalize();
    this.raycaster.set(origin, _dir);
    this.raycaster.near = 0.05;
    this.raycaster.far = Math.max(0.05, distance - 0.18);

    const hits = this.raycaster.intersectObjects(this._getOccluders(), this._shouldRecurseOccluders());
    for (const hit of hits) {
      const object = hit.object;
      if (!object?.isMesh || !object.visible) continue;
      if (isLineOfSightIgnored(object, hit)) continue;
      if (excludedRoots.some((root) => root && isDescendantOf(object, root))) continue;
      return false;
    }

    return true;
  }

  _sampleIllumination(worldPosition) {
    const sampled = this.lights?.sampleIllumination?.(worldPosition);
    if (Number.isFinite(sampled)) return clamp(sampled, 0, 1);

    const list = Array.isArray(this.lights?.list) ? this.lights.list : [];
    if (list.length === 0) return 0;

    let total = 0;
    for (const light of list) {
      if (light?.alive === false || !light.position) continue;

      const lightPos = toVector3(light.position, _target);
      const range = Math.max(0.001, light.range ?? 10);
      const distance = lightPos.distanceTo(worldPosition);
      if (distance > range) continue;

      if (light.castShadow && !this._lightReachesTarget(lightPos, worldPosition, distance)) continue;

      const intensity = light.intensity ?? 1;
      const falloff = 1 - smoothstep(range * 0.25, range, distance);
      total += intensity * falloff;
    }

    return clamp(total / 3, 0, 1);
  }

  _lightReachesTarget(lightPosition, targetPosition, distance) {
    if (!this.scene) return true;

    _lightDir.subVectors(targetPosition, lightPosition).normalize();
    this.raycaster.set(lightPosition, _lightDir);
    this.raycaster.near = 0.05;
    this.raycaster.far = Math.max(0.05, distance - 0.12);

    const hits = this.raycaster.intersectObjects(this._getOccluders(), this._shouldRecurseOccluders());
    for (const hit of hits) {
      const object = hit.object;
      if (!object?.isMesh || !object.visible) continue;
      if (isLineOfSightIgnored(object, hit)) continue;
      return false;
    }

    return true;
  }

  _getOccluders() {
    const source = this._occluderSourceFromRoom();
    if (source) {
      if (source !== this._occluderSource || source.length !== this._occluderSourceLength) {
        this._occluderSource = source;
        this._occluderSourceLength = source.length;
        this._cachedOccluders = source.filter(Boolean);
      }
      return this._cachedOccluders;
    }

    this._occluderSource = null;
    this._occluderSourceLength = -1;
    this._cachedOccluders = null;
    return this.scene?.children ?? [];
  }

  _shouldRecurseOccluders() {
    return !this._occluderSourceFromRoom();
  }

  _occluderSourceFromRoom() {
    const candidates = [
      this.lights?.room?.occluders,
      this.scene?.userData?.room?.occluders,
      this.scene?.userData?.roomOccluders,
      this.scene?.userData?.occluders,
    ];
    return candidates.find((list) => Array.isArray(list) && list.length > 0) ?? null;
  }

  _emptyResult(position, visibility) {
    return {
      score: 0,
      position: position?.clone?.() ?? null,
      illumination: 0,
      ambientIllumination: 0,
      flashlight: 0,
      visibility: clamp(visibility ?? 0, 0, 1),
    };
  }
}

function entityBasePosition(entity, out) {
  if (!entity) return null;
  if (entity.position?.isVector3) return out.copy(entity.position);
  if (entity.mesh?.getWorldPosition) return entity.mesh.getWorldPosition(out);
  if (entity.object?.getWorldPosition) return entity.object.getWorldPosition(out);
  if (entity.group?.getWorldPosition) return entity.group.getWorldPosition(out);
  if (entity.camera?.getWorldPosition) return entity.camera.getWorldPosition(out);
  return null;
}

function toVector3(value, out) {
  if (value?.isVector3) return out.copy(value);
  return out.set(value?.x ?? 0, value?.y ?? 0, value?.z ?? 0);
}

function isDescendantOf(object, root) {
  let cursor = object;
  while (cursor) {
    if (cursor === root) return true;
    cursor = cursor.parent;
  }
  return false;
}

function isLineOfSightIgnored(object, hit = null) {
  let cursor = object;
  while (cursor) {
    const data = cursor.userData ?? {};
    if (
      data.perceptionIgnore === true ||
      data.noLineOfSight === true ||
      data.lightVolume === true ||
      data.isDecal === true ||
      data.isVfx === true ||
      data.isCombatVfx === true
    ) {
      return true;
    }

    if (hasIgnoredName(cursor.name)) return true;
    if (cursor === object && isTransparentLineOfSightMaterial(materialForHit(cursor.material, hit))) return true;
    cursor = cursor.parent;
  }
  return false;
}

function hasIgnoredName(name = '') {
  const normalized = name.toLowerCase();
  return normalized.includes('pool') || normalized.includes('volume') || normalized.includes('haze');
}

function materialForHit(material, hit) {
  if (!Array.isArray(material)) return material;
  const index = hit?.face?.materialIndex;
  if (Number.isInteger(index) && material[index]) return material[index];
  return material;
}

function isTransparentLineOfSightMaterial(material) {
  if (Array.isArray(material)) return material.every(isTransparentLineOfSightMaterial);
  if (!material?.transparent) return false;
  const opacity = materialOpacity(material);
  return opacity < 0.95;
}

function materialOpacity(material) {
  const values = [];
  if (Number.isFinite(material?.opacity)) values.push(material.opacity);
  const uniformOpacity = material?.uniforms?.opacity?.value;
  if (Number.isFinite(uniformOpacity)) values.push(uniformOpacity);
  return values.length > 0 ? Math.min(...values) : 1;
}
