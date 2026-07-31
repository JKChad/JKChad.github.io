import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { BodyModel } from '../core/ai/BodyModel.js';
import { ACTION } from '../core/input/InputSeat.js';

const INTERACT_RADIUS = 1.5;
const BODY_VIEW_DISTANCE = 10;
const BODY_VIEW_DOT = Math.cos((105 * Math.PI) / 180 / 2);
const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
const _tmpC = new THREE.Vector3();

export class BodySystem {
  constructor(scene, bus, options = {}) {
    this.scene = scene;
    this.bus = bus;
    this.model = options.model ?? new BodyModel();
    this.hideSpots = sanitizeHideSpots(options.hideSpots ?? discoverHideSpots(scene));
    this.interactRadius = options.interactRadius ?? INTERACT_RADIUS;
    this.bodyViewDistance = options.bodyViewDistance ?? BODY_VIEW_DISTANCE;
    this.raycaster = new THREE.Raycaster();
    this.bodyMeshes = new Map();
    this._knownSourceIds = new Set();
    this._interactPulse = false;
    this._lastSeatInteract = false;

    this.root = new THREE.Group();
    this.root.name = 'guard-body-system';
    this.root.userData.perceptionIgnore = true;
    this.root.userData.combatIgnore = true;
    scene?.add?.(this.root);

    this._onGuardKilled = (payload) => this.createBodyFromGuard(payload);
    this.bus?.on?.('guard:killed', this._onGuardKilled);

    const win = globalThis.window ?? null;
    this._onKeyDown = (event) => {
      if (event.repeat || event.code !== 'KeyE') return;
      this._interactPulse = true;
    };
    win?.addEventListener?.('keydown', this._onKeyDown);
    this._window = win;
  }

  createBodyFromGuard({ guard, hitPoint = null, hit = null } = {}) {
    const sourceId = guard?.id ?? guard?.brain?.id ?? guard?.uuid ?? guard?.name ?? null;
    if (sourceId && this._knownSourceIds.has(sourceId)) return null;
    if (sourceId) this._knownSourceIds.add(sourceId);

    const pos = positionFrom(hitPoint ?? hit?.point ?? guard?.position ?? guard?.mesh ?? guard, _tmpA);
    if (pos) pos.y = 0;
    const body = this.model.createBody({
      sourceId,
      pos,
      meta: { guard },
    });

    const mesh = this._createBodyMesh(body);
    this.bodyMeshes.set(body.id, mesh);
    this.bus?.emit?.('body:created', { body, guard, mesh });
    return body;
  }

  update(dt, { player = null, guards = [], seat = null } = {}) {
    const guardList = Array.isArray(guards) ? guards : [guards].filter(Boolean);
    this._handleInteraction(player, seat);
    this._updateBodyMeshes();
    this._scanForBodies(guardList);
  }

  nearestInteractable(player) {
    const playerPos = positionFrom(player, _tmpA);
    if (!playerPos) return null;
    return this.model.findNearest(playerPos, {
      radius: this.interactRadius,
      includeHidden: false,
    });
  }

  hideBody(body, hideSpot = null) {
    if (!body || body.hidden) return null;
    const spot = hideSpot ?? this._nearestHideSpot(body.pos);
    if (!spot) return null;

    const hidden = this.model.hideBody(body.id, spot.pos);
    const mesh = this.bodyMeshes.get(body.id);
    if (mesh) {
      mesh.position.copy(toVector3(hidden.pos, _tmpA));
      mesh.visible = false;
    }
    this.bus?.emit?.('body:hidden', { body: hidden, hideSpot: spot });
    return hidden;
  }

  addHideSpot(pos, options = {}) {
    const spot = {
      id: options.id ?? `hide-${this.hideSpots.length + 1}`,
      pos: toVector3(pos, new THREE.Vector3()).clone(),
      kind: options.kind ?? 'hideSpot',
    };
    this.hideSpots.push(spot);
    return spot;
  }

  dispose() {
    this.bus?.off?.('guard:killed', this._onGuardKilled);
    this._window?.removeEventListener?.('keydown', this._onKeyDown);
    this.scene?.remove?.(this.root);
    for (const mesh of this.bodyMeshes.values()) {
      mesh.traverse?.((child) => {
        child.geometry?.dispose?.();
        child.material?.dispose?.();
      });
    }
    this.bodyMeshes.clear();
  }

  _handleInteraction(player, seat) {
    const seatInteract = Boolean(
      seat?.pressed?.(ACTION.Interact) ||
        seat?.pressed?.('interact') ||
        seat?.frame?.interact ||
        seat?.interact
    );
    const pressed = this._interactPulse || (seatInteract && !this._lastSeatInteract);
    this._interactPulse = false;
    this._lastSeatInteract = seatInteract;
    if (!pressed) return;

    const nearest = this.nearestInteractable(player);
    if (!nearest) return;
    const hidden = this.hideBody(nearest.body);
    if (hidden) this.bus?.emit?.('body:interacted', { body: hidden, action: 'hide' });
  }

  _scanForBodies(guards) {
    const bodies = this.model.list({ includeHidden: false });
    if (bodies.length === 0) return;

    for (const guard of guards) {
      if (!guard?.alive || guard.state === 'dead') continue;
      const guardId = guard.id ?? guard.brain?.id ?? guard.mesh?.uuid ?? 'guard';
      const eye = guard.getEyePosition?.(_tmpA) ?? positionFrom(guard, _tmpA)?.add(new THREE.Vector3(0, 1.65, 0));
      if (!eye) continue;

      for (const body of bodies) {
        if (body.sourceId && body.sourceId === guardId) continue;
        const bodyPos = toVector3(body.pos, _tmpB);
        const distance = eye.distanceTo(bodyPos);
        if (distance > this.bodyViewDistance) continue;

        _tmpC.subVectors(bodyPos, eye);
        _tmpC.y = 0;
        if (_tmpC.lengthSq() <= 0.0001) continue;
        _tmpC.normalize();
        if (guard.forward?.dot(_tmpC) < BODY_VIEW_DOT) continue;
        if (!this._hasLineOfSight(eye, bodyPos, distance, [guard.mesh, this.bodyMeshes.get(body.id)])) continue;
        if (!this.model.markFound(body.id, guardId)) continue;

        guard.findBody?.(bodyPos);
        this.bus?.emit?.('body:found', { body, guard, pos: bodyPos.clone() });
      }
    }
  }

  _hasLineOfSight(origin, target, distance, excludedRoots = []) {
    if (!this.scene) return true;
    _tmpC.subVectors(target, origin).normalize();
    this.raycaster.set(origin, _tmpC);
    this.raycaster.near = 0.05;
    this.raycaster.far = Math.max(0.05, distance - 0.2);

    const occluders = this.scene.userData?.room?.occluders ?? this.scene.userData?.occluders ?? this.scene.children;
    const hits = this.raycaster.intersectObjects(occluders, occluders === this.scene.children);
    for (const hit of hits) {
      const object = hit.object;
      if (!object?.isMesh || !object.visible) continue;
      if (excludedRoots.some((root) => root && isDescendantOf(object, root))) continue;
      if (isIgnored(object)) continue;
      return false;
    }
    return true;
  }

  _nearestHideSpot(pos) {
    if (this.hideSpots.length === 0) return null;
    const bodyPos = toVector3(pos, _tmpA);
    let best = null;
    let bestDistance = Infinity;
    for (const spot of this.hideSpots) {
      const distance = bodyPos.distanceTo(spot.pos);
      if (distance < bestDistance) {
        best = spot;
        bestDistance = distance;
      }
    }
    return best;
  }

  _createBodyMesh(body) {
    const group = new THREE.Group();
    group.name = 'unhidden guard body';
    group.position.copy(toVector3(body.pos, _tmpA));
    group.rotation.y = seededUnit(body.id ?? body.sourceId ?? 'body') * Math.PI * 2;
    group.userData.bodyId = body.id;
    group.userData.perceptionIgnore = true;
    group.userData.combatIgnore = true;

    const material = new THREE.MeshStandardMaterial({
      color: 0x202732,
      roughness: 0.78,
      metalness: 0.04,
      emissive: 0x05070a,
      emissiveIntensity: 0.25,
    });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.24, 1.15), material);
    torso.position.y = 0.18;
    torso.castShadow = true;
    torso.receiveShadow = true;
    torso.userData.perceptionIgnore = true;
    torso.userData.combatIgnore = true;
    group.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), material);
    head.position.set(0, 0.2, -0.72);
    head.castShadow = true;
    head.userData.perceptionIgnore = true;
    head.userData.combatIgnore = true;
    group.add(head);

    this.root.add(group);
    return group;
  }

  _updateBodyMeshes() {
    for (const body of this.model.list()) {
      const mesh = this.bodyMeshes.get(body.id);
      if (!mesh) continue;
      mesh.position.copy(toVector3(body.pos, _tmpA));
      mesh.visible = !body.hidden;
    }
  }
}

function discoverHideSpots(scene) {
  const spots = defaultHideSpots();
  scene?.traverse?.((object) => {
    const data = object.userData ?? {};
    const name = (object.name ?? '').toLowerCase();
    const isHideSpot =
      data.hideSpot === true ||
      name.includes('cabinet') ||
      name.includes('locker') ||
      name.includes('crate') ||
      name.includes('server rack') ||
      name.includes('shadow');
    if (!isHideSpot) return;
    object.getWorldPosition?.(_tmpA);
    spots.push({
      id: data.hideSpotId ?? object.uuid,
      pos: _tmpA.clone(),
      kind: data.hideSpotKind ?? (name.includes('shadow') ? 'shadow' : 'cover'),
    });
  });
  return spots;
}

function defaultHideSpots() {
  const halfW = CONFIG.room.width * 0.5;
  const halfD = CONFIG.room.depth * 0.5;
  return [
    { id: 'shadow-nw', pos: new THREE.Vector3(-halfW + 1.8, 0, -halfD + 1.8), kind: 'shadow' },
    { id: 'shadow-ne', pos: new THREE.Vector3(halfW - 1.8, 0, -halfD + 1.8), kind: 'shadow' },
    { id: 'crate-sw', pos: new THREE.Vector3(-halfW + 2.4, 0, halfD - 2.2), kind: 'cabinet' },
    { id: 'crate-se', pos: new THREE.Vector3(halfW - 2.4, 0, halfD - 2.2), kind: 'cabinet' },
  ];
}

function sanitizeHideSpots(spots) {
  return (Array.isArray(spots) ? spots : [])
    .map((spot, index) => ({
      id: spot.id ?? `hide-${index + 1}`,
      pos: toVector3(spot.pos ?? spot.position ?? spot, new THREE.Vector3()).clone(),
      kind: spot.kind ?? 'hideSpot',
    }))
    .filter((spot) => Number.isFinite(spot.pos.x) && Number.isFinite(spot.pos.z));
}

function positionFrom(value, out) {
  if (!value) return null;
  if (value.isVector3) return out.copy(value);
  if (value.position?.isVector3) return out.copy(value.position);
  if (value.mesh?.getWorldPosition) return value.mesh.getWorldPosition(out);
  if (value.object?.getWorldPosition) return value.object.getWorldPosition(out);
  if (value.camera?.getWorldPosition) return value.camera.getWorldPosition(out);
  if (value.getWorldPosition) return value.getWorldPosition(out);
  if (Number.isFinite(value.x) && Number.isFinite(value.z)) return out.set(value.x, value.y ?? 0, value.z);
  return null;
}

function toVector3(value, out) {
  if (value?.isVector3) return out.copy(value);
  return out.set(value?.x ?? 0, value?.y ?? 0, value?.z ?? 0);
}

function seededUnit(seed) {
  return hashString(seed) / 4294967295;
}

function hashString(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isDescendantOf(object, root) {
  let cursor = object;
  while (cursor) {
    if (cursor === root) return true;
    cursor = cursor.parent;
  }
  return false;
}

function isIgnored(object) {
  let cursor = object;
  while (cursor) {
    const data = cursor.userData ?? {};
    if (
      data.perceptionIgnore === true ||
      data.noLineOfSight === true ||
      data.isDecal === true ||
      data.isVfx === true ||
      data.isCombatVfx === true ||
      data.combatIgnore === true
    ) {
      return true;
    }
    cursor = cursor.parent;
  }
  return false;
}
