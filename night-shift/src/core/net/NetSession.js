/**
 * Host-authoritative session protocol (engine-agnostic payload shapes).
 *
 * Roles:
 *  - host: simulates world, owns AttentionModel, broadcasts snapshots
 *  - client: predicts local movement, applies host visibility/attention verbatim
 *
 * Channels (over WebRTC DataChannel JSON frames):
 *  hello, welcome, input, snapshot, event, leave, ping
 */

export const MSG = {
  HELLO: 'hello',
  WELCOME: 'welcome',
  INPUT: 'input',
  SNAPSHOT: 'snapshot',
  EVENT: 'event',
  LEAVE: 'leave',
  PING: 'ping',
  PONG: 'pong',
};

export function encode(type, payload = {}) {
  return JSON.stringify({ t: type, ...payload, ts: performance.now?.() ?? Date.now() });
}

export function decode(raw) {
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/**
 * Movement prediction buffer for a single local seat.
 * Client stores unacked inputs; host snapshots reconcile position with smoothing.
 */
export class MovementPredictor {
  constructor({ maxBuffered = 64 } = {}) {
    this.maxBuffered = maxBuffered;
    this.pending = [];
    this.authoritative = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, seq: 0 };
    this.predicted = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  }

  pushInput(seq, input, predictedState) {
    this.pending.push({ seq, input, state: { ...predictedState } });
    if (this.pending.length > this.maxBuffered) this.pending.shift();
  }

  /**
   * Apply host snapshot. Returns corrected predicted state.
   * Visibility is NOT predicted — callers must apply attention from snap separately.
   */
  reconcile(hostState, replaySimulate) {
    this.authoritative = { ...hostState };
    // Drop acked inputs
    this.pending = this.pending.filter((p) => p.seq > hostState.seq);
    // Reset to host and replay
    let state = {
      x: hostState.x,
      y: hostState.y,
      z: hostState.z,
      yaw: hostState.yaw,
      pitch: hostState.pitch,
    };
    for (const p of this.pending) {
      state = replaySimulate(state, p.input) || state;
    }
    this.predicted = state;
    return state;
  }
}

/**
 * Session logic without transport. Wire to WebRTC / local loopback adapters.
 */
export class NetSession {
  constructor({ bus, attention, isHost = true, localSeat = 0 } = {}) {
    this.bus = bus;
    this.attention = attention;
    this.isHost = isHost;
    this.localSeat = localSeat;
    this.remoteSeat = localSeat === 0 ? 1 : 0;
    this.connected = false;
    this.peerId = null;
    this.remoteId = null;
    this.rttMs = 0;
    this.lossSim = 0;
    this._send = null;
    this._players = {
      0: { present: false, lastInputSeq: 0, state: null },
      1: { present: false, lastInputSeq: 0, state: null },
    };
    this._players[localSeat].present = true;
    this.predictor = new MovementPredictor();
    this._snapshotHz = 20;
    this._snapshotAccum = 0;
    this._lastPing = 0;
  }

  attachTransport(sendFn) {
    this._send = sendFn;
  }

  send(type, payload) {
    if (!this._send) return;
    if (this.lossSim > 0 && Math.random() < this.lossSim) return;
    this._send(encode(type, payload));
  }

  onConnected(remoteId) {
    this.connected = true;
    this.remoteId = remoteId;
    this._players[this.remoteSeat].present = true;
    this.bus?.emit('net:connected', { remoteId, isHost: this.isHost });
    if (this.isHost) {
      this.send(MSG.WELCOME, {
        you: this.remoteSeat,
        host: this.localSeat,
        attention: this.attention.snapshot(),
      });
    } else {
      this.send(MSG.HELLO, { seat: this.localSeat });
    }
  }

  onDisconnected(reason = 'peer-left') {
    this.connected = false;
    this._players[this.remoteSeat].present = false;
    this.bus?.emit('net:disconnected', { reason, seat: this.remoteSeat });
    // Graceful solo continue — attention rebalances toward remaining player.
    if (this.isHost && this.attention) {
      this.attention.setTransferIntent(this.remoteSeat, 0);
      // Pull remaining heat to local so solo isn't permanently ghosted/hot wrongly.
      const snap = this.attention.snapshot();
      if (this.localSeat === 0) this.attention.spikeToward(0, 50 - snap.p0);
      else this.attention.spikeToward(1, 50 - snap.p1);
    }
  }

  /** Client → host input each tick */
  sendLocalInput(inputPacket, predictedState) {
    this.predictor.pushInput(inputPacket.seq, inputPacket, predictedState);
    if (!this.connected || this.isHost) return;
    this.send(MSG.INPUT, { input: inputPacket, state: predictedState });
  }

  /** Host broadcasts world snapshot */
  maybeBroadcast(dt, buildSnapshot) {
    if (!this.isHost || !this.connected) return;
    this._snapshotAccum += dt;
    if (this._snapshotAccum < 1 / this._snapshotHz) return;
    this._snapshotAccum = 0;
    const snap = buildSnapshot();
    snap.attention = this.attention.snapshot();
    this.send(MSG.SNAPSHOT, { snap });
  }

  handleMessage(raw) {
    const msg = decode(raw);
    if (!msg?.t) return;

    switch (msg.t) {
      case MSG.HELLO:
        if (this.isHost) {
          this._players[this.remoteSeat].present = true;
          this.send(MSG.WELCOME, {
            you: this.remoteSeat,
            host: this.localSeat,
            attention: this.attention.snapshot(),
          });
        }
        break;
      case MSG.WELCOME:
        if (!this.isHost) {
          this.localSeat = msg.you ?? this.localSeat;
          this.remoteSeat = msg.host ?? this.remoteSeat;
          this.attention.applySnapshot(msg.attention);
          this.bus?.emit('net:welcome', msg);
        }
        break;
      case MSG.INPUT:
        if (this.isHost) {
          this.bus?.emit('net:remote-input', {
            seat: this.remoteSeat,
            input: msg.input,
            state: msg.state,
          });
          this._players[this.remoteSeat].lastInputSeq = msg.input?.seq ?? 0;
        }
        break;
      case MSG.SNAPSHOT:
        if (!this.isHost && msg.snap) {
          // Attention is authoritative — apply before movement reconcile.
          if (msg.snap.attention) this.attention.applySnapshot(msg.snap.attention);
          this.bus?.emit('net:snapshot', msg.snap);
        }
        break;
      case MSG.EVENT:
        this.bus?.emit('net:event', msg.event);
        break;
      case MSG.LEAVE:
        this.onDisconnected(msg.reason || 'leave');
        break;
      case MSG.PING:
        this.send(MSG.PONG, { echo: msg.ts });
        break;
      case MSG.PONG:
        this.rttMs = Math.max(0, (performance.now?.() ?? Date.now()) - (msg.echo || 0));
        this.bus?.emit('net:rtt', { rttMs: this.rttMs });
        break;
      default:
        break;
    }
  }

  update(dt) {
    if (!this.connected) return;
    this._lastPing += dt;
    if (this._lastPing > 1) {
      this._lastPing = 0;
      this.send(MSG.PING, {});
    }
  }

  remotePresent() {
    return this._players[this.remoteSeat].present;
  }
}
