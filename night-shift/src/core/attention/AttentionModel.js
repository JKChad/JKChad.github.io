import { clamp } from '../math/index.js';

/**
 * Host-authoritative shared attention. Always sums to `total`.
 * Clients send transfer intents; only the host mutates shares.
 * Visibility state is reconciled from host snapshots — never predicted.
 */
export class AttentionModel {
  constructor({ total = 100, transferRate = 55, bus = null } = {}) {
    this.total = total;
    this.transferRate = transferRate;
    this.bus = bus;
    this.shares = { p0: total * 0.5, p1: total * 0.5 };
    this._transferDir = { p0: 0, p1: 0 };
    this.revision = 0;
  }

  visibility(seat) {
    const key = seat === 0 ? 'p0' : 'p1';
    return this.shares[key] / this.total;
  }

  /** Host only: set continuous transfer intent for a seat. dir in {-1,0,1} */
  setTransferIntent(seat, dir) {
    const key = seat === 0 ? 'p0' : 'p1';
    this._transferDir[key] = dir < 0 ? -1 : dir > 0 ? 1 : 0;
  }

  /** Host only: spike attention toward a seat (noise / shot). */
  spikeToward(seat, amount) {
    const delta = seat === 0 ? amount : -amount;
    this._applyDelta(delta);
  }

  /** Host only. */
  update(dt) {
    // p0 pulling (+1) increases p0 share; p1 pulling (+1) decreases p0 share.
    const net =
      this._transferDir.p0 * this.transferRate * dt -
      this._transferDir.p1 * this.transferRate * dt;
    if (net !== 0) this._applyDelta(net);
  }

  /** Apply authoritative snapshot from host (clients). Never invent visibility. */
  applySnapshot(snap) {
    if (!snap || typeof snap.p0 !== 'number') return;
    if (snap.revision != null && snap.revision < this.revision) return;
    this.shares.p0 = clamp(snap.p0, 0, this.total);
    this.shares.p1 = this.total - this.shares.p0;
    if (snap.revision != null) this.revision = snap.revision;
    this.bus?.emit('attention:changed', this.snapshot());
  }

  snapshot() {
    return {
      p0: this.shares.p0,
      p1: this.shares.p1,
      revision: this.revision,
      v0: this.visibility(0),
      v1: this.visibility(1),
    };
  }

  _applyDelta(deltaTowardP0) {
    this.shares.p0 = clamp(this.shares.p0 + deltaTowardP0, 0, this.total);
    this.shares.p1 = this.total - this.shares.p0;
    this.revision++;
    this.bus?.emit('attention:changed', this.snapshot());
  }
}
