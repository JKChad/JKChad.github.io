import { CONFIG } from '../config.js';
import { clamp } from '../utils/math.js';

/**
 * Shared attention always sums to 100 between local player (P1) and partner (P2).
 * Whoever holds attention is visible/tracked; the other fades toward ghost.
 */
export class AttentionMeter {
  constructor(bus) {
    this.bus = bus;
    this.p1 = 50;
    this.p2 = 50;
    this._transferDir = 0; // -1 release to partner, +1 hold/pull
  }

  get localShare() {
    return this.p1;
  }

  get partnerShare() {
    return this.p2;
  }

  /** 0 = fully ghost, 1 = fully hot */
  get localVisibility() {
    return this.p1 / CONFIG.attention.total;
  }

  get partnerVisibility() {
    return this.p2 / CONFIG.attention.total;
  }

  setTransfer(dir) {
    this._transferDir = dir;
  }

  /** Instant spike toward local (distraction / shot / cough). */
  spikeLocal(amount) {
    this._applyDelta(amount);
  }

  /** Instant spike toward partner — frees local window. */
  spikePartner(amount) {
    this._applyDelta(-amount);
  }

  _applyDelta(deltaTowardLocal) {
    this.p1 = clamp(this.p1 + deltaTowardLocal, 0, CONFIG.attention.total);
    this.p2 = CONFIG.attention.total - this.p1;
    this.bus.emit('attention:changed', { p1: this.p1, p2: this.p2 });
  }

  update(dt) {
    if (this._transferDir === 0) return;
    const rate = CONFIG.attention.transferRate * this._transferDir * dt;
    this._applyDelta(rate);
  }
}
