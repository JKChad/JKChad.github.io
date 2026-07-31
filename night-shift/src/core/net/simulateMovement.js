import { clamp, damp } from '../math/index.js';
import { CONFIG } from '../../config.js';

const ROOM_WIDTH = CONFIG.room.width;
const ROOM_DEPTH = CONFIG.room.depth;
const ROOM_X_MIN = -ROOM_WIDTH * 0.5 + 0.5;
const ROOM_X_MAX = ROOM_WIDTH * 0.5 - 0.5;
const ROOM_Z_MIN = -ROOM_DEPTH * 0.5 + 0.5;
const ROOM_Z_MAX = ROOM_DEPTH * 0.5 - 0.5;
const HALF_PI = Math.PI * 0.5;

const DEFAULT_DT = CONFIG.fixedDt;

function numberOr(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function buttonMask(input = {}) {
  if (Number.isFinite(input.b)) return input.b;
  return (
    (input.walk ? 1 : 0) |
    (input.crouch ? 2 : 0) |
    (input.fire ? 4 : 0) |
    (input.ads ? 8 : 0) |
    (input.reload ? 16 : 0) |
    (input.distract ? 32 : 0) |
    (input.melee ? 64 : 0) |
    (input.holdAttention ? 128 : 0) |
    (input.releaseAttention ? 256 : 0) |
    (input.gadget ? 512 : 0) |
    (input.interact ? 1024 : 0)
  );
}

/**
 * Browser-free movement replay used by MovementPredictor reconciliation.
 * Accepts compact InputSeat.toNet packets (mx/my/lx/ly/b) plus optional yaw/pitch.
 */
export function simulateMovement(state = {}, input = {}) {
  const dt = Math.min(Math.max(numberOr(input.dt, DEFAULT_DT), 0), CONFIG.maxFrameDt);
  const buttons = buttonMask(input);
  const walk = Boolean(buttons & 1);
  const crouch = Boolean(buttons & 2);

  const yaw = Number.isFinite(input.yaw)
    ? input.yaw
    : numberOr(state.yaw) + numberOr(input.lx ?? input.lookX) * dt;
  const pitch = clamp(
    Number.isFinite(input.pitch)
      ? input.pitch
      : numberOr(state.pitch) + numberOr(input.ly ?? input.lookY) * dt,
    -HALF_PI + 0.02,
    HALF_PI - 0.02,
  );

  const moveX = clamp(numberOr(input.mx ?? input.moveX), -1, 1);
  const moveY = clamp(numberOr(input.my ?? input.moveY), -1, 1);
  const len = Math.hypot(moveX, moveY);
  const nx = len > 1 ? moveX / len : moveX;
  const ny = len > 1 ? moveY / len : moveY;

  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const wishX = rightX * nx + forwardX * ny;
  const wishZ = rightZ * nx + forwardZ * ny;
  const hasInput = Math.hypot(wishX, wishZ) > 0.0001;
  const speed = crouch
    ? CONFIG.player.crouchSpeed
    : walk
      ? CONFIG.player.walkSpeed
      : CONFIG.player.runSpeed;
  const accel = hasInput ? (crouch ? 18 : 24) : 20;
  const targetVx = hasInput ? wishX * speed : 0;
  const targetVz = hasInput ? wishZ * speed : 0;
  const vx = damp(numberOr(state.vx), targetVx, accel, dt);
  const vz = damp(numberOr(state.vz), targetVz, accel, dt);

  return {
    ...state,
    x: clamp(numberOr(state.x) + vx * dt, ROOM_X_MIN, ROOM_X_MAX),
    y: 0,
    z: clamp(numberOr(state.z) + vz * dt, ROOM_Z_MIN, ROOM_Z_MAX),
    yaw,
    pitch,
    vx,
    vz,
    walk,
    crouch,
    seq: input.seq ?? state.seq ?? 0,
  };
}
