/**
 * Engine-agnostic event bus. No DOM / Three.js.
 */
export class EventBus {
  constructor() {
    this._map = new Map();
  }

  on(type, fn) {
    if (!this._map.has(type)) this._map.set(type, new Set());
    this._map.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this._map.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this._map.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear() {
    this._map.clear();
  }
}
