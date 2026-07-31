/**
 * Engine-agnostic math — no Three.js. Ports cleanly to native engines.
 */

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const saturate = (v) => clamp(v, 0, 1);

export function smoothstep(edge0, edge1, x) {
  const t = saturate((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function vec3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

export function copy3(out, a) {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function add3(out, a, b) {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function sub3(out, a, b) {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function scale3(out, a, s) {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

export function length3(a) {
  return Math.hypot(a.x, a.y, a.z);
}

export function lengthSq3(a) {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function normalize3(out, a) {
  const len = length3(a) || 1;
  out.x = a.x / len;
  out.y = a.y / len;
  out.z = a.z / len;
  return out;
}

export function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function distanceXZ(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function dampAngle(current, target, lambda, dt) {
  let delta = ((target - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return current + delta * (1 - Math.exp(-lambda * dt));
}
