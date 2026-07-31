import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Footsteps } from './Footsteps.js';
import { GuardBarks } from './GuardBarks.js';
import { MusicDirector } from './MusicDirector.js';
import { SpatialAudio } from './SpatialAudio.js';

const _origin = new THREE.Vector3();
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _rayStart = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function vectorFrom(value, out) {
  if (value?.isVector3) return out.copy(value);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return out.set(value.x, value.y, value.z);
  }
  return out.set(0, 0, 0);
}

function materialForHit(material, hit) {
  if (!Array.isArray(material)) return material;
  const index = hit?.face?.materialIndex;
  return Number.isInteger(index) && material[index] ? material[index] : material[0];
}

function surfaceFromObject(object, hit = null) {
  let cursor = object;
  while (cursor) {
    if (cursor.userData?.surface) return cursor.userData.surface;
    const material = materialForHit(cursor.material, hit);
    if (material?.userData?.surface) return material.userData.surface;
    cursor = cursor.parent;
  }
  return null;
}

function makeSurfaceSampler(scene, room) {
  const raycaster = new THREE.Raycaster();
  const roots = room?.group ? [room.group] : scene?.children ?? [];
  const fallback = room?.floor?.userData?.surface ?? room?.materials?.floor?.userData?.surface ?? 'concrete';

  return (position) => {
    vectorFrom(position, _rayStart);
    _rayStart.y += 1.25;
    raycaster.set(_rayStart, _down);
    raycaster.near = 0;
    raycaster.far = 2.8;

    const hits = raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      if (!hit.object?.visible) continue;
      if (hit.object.userData?.isDecal || hit.object.userData?.isCombatVfx || hit.object.userData?.lightVolume) continue;
      const surface = surfaceFromObject(hit.object, hit);
      if (surface) return surface;
    }
    return fallback;
  };
}

function makeOcclusionSampler(scene, room) {
  const raycaster = new THREE.Raycaster();
  const occluders = Array.isArray(room?.occluders) && room.occluders.length > 0 ? room.occluders : scene?.children ?? [];
  const recurse = occluders === scene?.children;

  return (listenerPos, sourcePos) => {
    vectorFrom(listenerPos, _origin);
    vectorFrom(sourcePos, _target);
    _dir.subVectors(_target, _origin);
    const distance = _dir.length();
    if (distance <= 0.1) return 0;
    _dir.multiplyScalar(1 / distance);

    raycaster.set(_origin, _dir);
    raycaster.near = 0.08;
    raycaster.far = Math.max(0.08, distance - 0.12);
    const hits = raycaster.intersectObjects(occluders, recurse);
    if (hits.length === 0) return 0;

    const spans = new Map();
    for (const hit of hits) {
      const object = hit.object;
      if (!object?.isMesh || !object.visible) continue;
      if (
        object.userData?.perceptionIgnore ||
        object.userData?.noLineOfSight ||
        object.userData?.isDecal ||
        object.userData?.isCombatVfx ||
        object.userData?.lightVolume
      ) {
        continue;
      }
      const span = spans.get(object) ?? { first: hit.distance, last: hit.distance };
      span.first = Math.min(span.first, hit.distance);
      span.last = Math.max(span.last, hit.distance);
      spans.set(object, span);
    }

    let wallDepth = 0;
    for (const span of spans.values()) {
      wallDepth += Math.max(0.08, span.last - span.first);
    }
    const wallCount = spans.size;
    const distanceShade = distance > 18 ? (distance - 18) / 24 : 0;
    return clamp01(wallCount * 0.22 + wallDepth * 0.85 + distanceShade * 0.18);
  };
}

function tierForGuardState(state) {
  switch (state) {
    case 'combat':
    case 'chase':
      return 'combat';
    case 'searchLost':
      return 'alert';
    case 'investigate':
      return 'suspicious';
    case 'alertLook':
      return 'notice';
    case 'patrol':
    default:
      return 'calm';
  }
}

function suspicion01(guard) {
  const threshold = CONFIG.guard.alarmThreshold || 1;
  return clamp01((guard?.suspicion ?? 0) / threshold);
}

export function installAudio(game) {
  const bus = game?.bus;
  const audio = game?.audio;
  const spatial = new SpatialAudio(audio, {
    listenerProvider: () => game?.player?.camera ?? game?.player,
    sampleOcclusion: makeOcclusionSampler(game?.scene, game?.room),
  });
  const footsteps = new Footsteps(audio, spatial, {
    sampleSurface: makeSurfaceSampler(game?.scene, game?.room),
  });
  const guardBarks = new GuardBarks(audio, spatial);
  const music = new MusicDirector(audio, { mode: game?.modes?.mode ?? 'stealth' });
  const unsubs = [];

  if (bus?.on) {
    unsubs.push(bus.on('player:footstep', (payload) => footsteps.play(payload)));
    unsubs.push(bus.on('guard:bark', (payload) => guardBarks.play(payload)));
    unsubs.push(bus.on('alert:facility', (payload = {}) => {
      music.setFacilityAlert(payload.level ?? payload.alert ?? payload.value ?? 0);
      if ((payload.level ?? 0) >= 0.65) {
        bus.emit('guard:bark', {
          tier: 'alert',
          guard: game?.guard,
          position: payload.position ?? game?.guard?.position,
          intensity: payload.level,
        });
      }
    }));
    unsubs.push(bus.on('mode:loud', (payload = {}) => {
      music.setMode('loud');
      music.setFacilityAlert(Math.max(music.facilityAlert, 0.62));
      bus.emit('guard:bark', {
        tier: 'combat',
        guard: game?.guard,
        position: game?.guard?.position,
        reason: payload.reason,
        force: true,
        intensity: 1.2,
      });
    }));
    unsubs.push(bus.on('guard:state', ({ guard, state, previous }) => {
      if (state === previous) return;
      bus.emit('guard:bark', {
        tier: tierForGuardState(state),
        state,
        previous,
        guard,
        position: guard?.position,
        intensity: state === 'patrol' ? 0.65 : 1,
      });
    }));
  }

  return {
    spatial,
    footsteps,
    guardBarks,
    music,
    update(dt) {
      spatial.update();
      music.update(dt, {
        mode: game?.modes?.mode ?? 'stealth',
        facilityAlert: music.facilityAlert,
        localSuspicion: suspicion01(game?.guard),
      });
    },
    dispose() {
      for (const unsub of unsubs) unsub?.();
    },
  };
}
