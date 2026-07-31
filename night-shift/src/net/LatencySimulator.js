const DEFAULT_RNG = () => Math.random();

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

/**
 * Optional one-way network impairment for local critic testing.
 */
export class LatencySimulator {
  constructor({ delayMs = 0, jitterMs = 0, loss = 0, rng = DEFAULT_RNG, enabled = true } = {}) {
    this.delayMs = Math.max(0, Number(delayMs) || 0);
    this.jitterMs = Math.max(0, Number(jitterMs) || 0);
    this.loss = clamp01(loss);
    this.rng = typeof rng === 'function' ? rng : DEFAULT_RNG;
    this.enabled = Boolean(enabled);
    this._timers = new Set();
  }

  static fromLocation(locationLike = globalThis.location) {
    const search = locationLike?.search ?? '';
    const params = new URLSearchParams(search);
    if (params.get('netTest') !== '1') return null;
    return new LatencySimulator({
      delayMs: Number(params.get('netDelayMs')) || 150,
      jitterMs: Number(params.get('netJitterMs')) || 0,
      loss: Number(params.get('netLoss')) || 0.05,
    });
  }

  get active() {
    return this.enabled && (this.delayMs > 0 || this.jitterMs > 0 || this.loss > 0);
  }

  schedule(fn, payload) {
    if (typeof fn !== 'function') return false;
    if (!this.active) {
      fn(payload);
      return true;
    }
    if (this.loss > 0 && this.rng() < this.loss) return false;

    const jitter = this.jitterMs > 0 ? (this.rng() * 2 - 1) * this.jitterMs : 0;
    const delay = Math.max(0, this.delayMs + jitter);
    const timer = setTimeout(() => {
      this._timers.delete(timer);
      fn(payload);
    }, delay);
    this._timers.add(timer);
    return true;
  }

  dispose() {
    for (const timer of this._timers) clearTimeout(timer);
    this._timers.clear();
  }
}
