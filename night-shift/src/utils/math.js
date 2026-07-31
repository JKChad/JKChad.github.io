import * as THREE from 'three';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const saturate = (v) => clamp(v, 0, 1);

export function smoothstep(edge0, edge1, x) {
  const t = saturate((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function randRange(a, b) {
  return a + Math.random() * (b - a);
}

export function randSign() {
  return Math.random() < 0.5 ? -1 : 1;
}

const _v = new THREE.Vector3();
export function horizontalDir(from, to, out = _v) {
  out.subVectors(to, from);
  out.y = 0;
  return out.normalize();
}
