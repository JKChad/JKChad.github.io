import { distanceXZ, vec3 } from '../math/index.js';

/**
 * Engine-agnostic corpse registry.
 * Stores only serializable position/state so presentation layers can render,
 * drag, or hide bodies without owning the AI facts.
 */
export class BodyModel {
  constructor() {
    this.bodies = new Map();
    this._nextId = 1;
  }

  createBody({ id = null, sourceId = null, pos = vec3(), hidden = false, meta = null } = {}) {
    const body = {
      id: id ?? `body-${this._nextId++}`,
      sourceId,
      pos: clonePos(pos),
      hidden: Boolean(hidden),
      foundBy: [],
      meta,
    };
    this.bodies.set(body.id, body);
    return body;
  }

  get(id) {
    return this.bodies.get(id) ?? null;
  }

  remove(id) {
    return this.bodies.delete(id);
  }

  updatePosition(id, pos) {
    const body = this.get(id);
    if (!body || !pos) return null;
    body.pos = clonePos(pos);
    return body;
  }

  hideBody(id, pos = null) {
    const body = this.get(id);
    if (!body) return null;
    body.hidden = true;
    if (pos) body.pos = clonePos(pos);
    return body;
  }

  markFound(bodyId, guardId) {
    const body = this.get(bodyId);
    if (!body) return false;
    const key = guardId ?? 'unknown';
    const firstFind = !body.foundBy.includes(key);
    if (firstFind) body.foundBy.push(key);
    return firstFind;
  }

  list({ includeHidden = true } = {}) {
    const bodies = [...this.bodies.values()];
    return includeHidden ? bodies : bodies.filter((body) => !body.hidden);
  }

  findNearest(pos, { radius = Infinity, includeHidden = true } = {}) {
    if (!pos) return null;
    let best = null;
    let bestDistance = radius;
    for (const body of this.list({ includeHidden })) {
      const distance = distanceXZ(pos, body.pos);
      if (distance <= bestDistance) {
        best = body;
        bestDistance = distance;
      }
    }
    return best ? { body: best, distance: bestDistance } : null;
  }
}

function clonePos(pos) {
  return vec3(pos?.x ?? 0, pos?.y ?? 0, pos?.z ?? 0);
}
