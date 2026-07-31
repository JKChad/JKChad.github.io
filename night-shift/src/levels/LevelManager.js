import * as THREE from 'three';
import { DEFAULT_LEVEL_ID, LEVELS_BY_ID } from './index.js';
import { LightFirstBuilder } from './LightFirstBuilder.js';

function toVector3(value, fallback = new THREE.Vector3()) {
  if (value?.isVector3) return value.clone();
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return new THREE.Vector3(value.x, value.y, value.z);
  }
  return fallback.clone();
}

function toPath(path = []) {
  return path.map((point) => toVector3(point));
}

export class LevelManager {
  constructor(scene, bus, lightsSystemFactory = null) {
    this.scene = scene;
    this.bus = bus;
    this.builder = new LightFirstBuilder(scene, bus, lightsSystemFactory);
    this.current = null;
    this.group = null;
    this.lights = null;
    this.colliders = [];
    this.occluders = [];
    this.decalReceivers = [];
    this.coverPoints = [];
    this.shadowPoints = [];
    this.patrols = [];
    this.patrolPath = [];
    this.extract = new THREE.Vector3();
    this.bounds = { w: 0, d: 0, h: 0 };
    this._alarmApplied = false;
  }

  load(levelId = DEFAULT_LEVEL_ID) {
    const level = typeof levelId === 'string' ? LEVELS_BY_ID[levelId] : levelId;
    if (!level) {
      throw new Error(`Unknown NIGHT SHIFT level "${levelId}".`);
    }

    // Builder order is intentional: author and spawn lights first, then geometry shells.
    const build = this.builder.build(level);
    this.current = level;
    this.group = build.group;
    this.lights = build.lights;
    this.colliders = build.colliders;
    this.occluders = build.occluders;
    this.decalReceivers = build.decalReceivers;
    this.coverPoints = (level.coverPoints ?? []).map((point) => toVector3(point));
    this.shadowPoints = (level.shadowPoints ?? []).map((point) => toVector3(point));
    this.patrols = (level.patrols ?? []).map((path) => toPath(path));
    this.patrolPath = this.patrols[0] ?? [];
    this.extract = toVector3(level.extract);
    this.bounds = { ...level.bounds };
    this._alarmApplied = false;

    this.scene.userData.room = this;
    this.scene.userData.roomOccluders = this.occluders;
    return this;
  }

  clear() {
    const activeOccluders = this.occluders;
    if (this.scene.userData.room === this) delete this.scene.userData.room;
    if (this.scene.userData.roomOccluders === activeOccluders) delete this.scene.userData.roomOccluders;

    this.builder.clear();
    this.current = null;
    this.group = null;
    this.lights = null;
    this.colliders = [];
    this.occluders = [];
    this.decalReceivers = [];
    this.coverPoints = [];
    this.shadowPoints = [];
    this.patrols = [];
    this.patrolPath = [];
    this.extract = new THREE.Vector3();
    this.bounds = { w: 0, d: 0, h: 0 };
    this._alarmApplied = false;
  }

  getCurrent() {
    return this.current;
  }

  getCoverPoints() {
    return this.coverPoints.map((point) => point.clone());
  }

  getShadowPoints() {
    return this.shadowPoints.map((point) => point.clone());
  }

  getExtract() {
    return this.extract.clone();
  }

  getPatrols() {
    return this.patrols.map((path) => path.map((point) => point.clone()));
  }

  applyAlarmLayout() {
    if (!this.current?.alarmLayout || this._alarmApplied) return false;
    const applied = this.builder.applyAlarmLayout(this.current.alarmLayout);
    this.builder.refreshColliders();
    this._alarmApplied = applied || this._alarmApplied;
    this.bus?.emit?.('level:alarmLayout', {
      levelId: this.current.id,
      layout: this.current.alarmLayout,
    });
    return applied;
  }

  update(dt) {
    this.lights?.update?.(dt);
  }
}
