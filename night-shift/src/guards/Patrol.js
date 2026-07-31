import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp } from '../utils/math.js';

const _toTarget = new THREE.Vector3();
const _desiredForward = new THREE.Vector3();

export function createPatrolPath(roomWidth = CONFIG.room.width, roomDepth = CONFIG.room.depth) {
  const margin = 3.2;
  const halfW = Math.max(1, roomWidth * 0.5 - margin);
  const halfD = Math.max(1, roomDepth * 0.5 - margin);

  return [
    new THREE.Vector3(-halfW, 0, -halfD),
    new THREE.Vector3(halfW, 0, -halfD),
    new THREE.Vector3(halfW, 0, halfD),
    new THREE.Vector3(-halfW, 0, halfD),
  ];
}

export class PatrolBrain {
  constructor(path = createPatrolPath(), options = {}) {
    this.waypoints = this._sanitizePath(path);
    this.index = 0;
    this.arriveRadius = options.arriveRadius ?? 0.35;
    this.cornerPause = options.cornerPause ?? 0.65;
    this.turnRate = options.turnRate ?? 7.5;
    this.waitTimer = 0;
  }

  setPath(path) {
    this.waypoints = this._sanitizePath(path);
    this.index = 0;
    this.waitTimer = 0;
  }

  get currentWaypoint() {
    return this.waypoints[this.index] ?? null;
  }

  update(dt, position, forward, speed) {
    const target = this.currentWaypoint;
    if (!target) return { moved: false, waiting: false, target: null, distance: 0 };

    if (this.waitTimer > 0) {
      this.waitTimer = Math.max(0, this.waitTimer - dt);
      return { moved: false, waiting: true, target, distance: position.distanceTo(target) };
    }

    _toTarget.subVectors(target, position);
    _toTarget.y = 0;
    const distance = _toTarget.length();

    if (distance <= this.arriveRadius) {
      this.index = (this.index + 1) % this.waypoints.length;
      this.waitTimer = this.cornerPause;
      return { moved: false, waiting: true, target, distance };
    }

    _desiredForward.copy(_toTarget).multiplyScalar(1 / Math.max(distance, 0.0001));
    this.turnToward(forward, _desiredForward, dt);

    const alignment = clamp(forward.dot(_desiredForward), -1, 1);
    const moveScale = clamp((alignment + 0.35) / 1.35, 0.2, 1);
    const step = Math.min(distance, speed * moveScale * dt);
    position.addScaledVector(forward, step);

    return { moved: step > 0, waiting: false, target, distance };
  }

  turnToward(forward, desiredForward, dt) {
    if (desiredForward.lengthSq() < 0.0001) return forward;

    const t = 1 - Math.exp(-this.turnRate * dt);
    forward.lerp(desiredForward, t).normalize();
    return forward;
  }

  _sanitizePath(path) {
    const points = Array.isArray(path) && path.length > 0 ? path : createPatrolPath();
    return points.map((point) => {
      if (point?.isVector3) return point.clone();
      return new THREE.Vector3(point?.x ?? 0, point?.y ?? 0, point?.z ?? 0);
    });
  }
}
