import { MSG, NetSession } from '../core/net/NetSession.js';
import { simulateMovement } from '../core/net/simulateMovement.js';
import { PeerTransport } from './PeerTransport.js';
import { LatencySimulator } from './LatencySimulator.js';

// Authority model: the host is the only peer that mutates AttentionModel and
// broadcasts attention in snapshots; clients send input/attention intents and
// apply host snapshots verbatim while predicting only their own movement.

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function normalizeDir(dir) {
  return dir < 0 ? -1 : dir > 0 ? 1 : 0;
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function stateWithSeq(state = {}, seq = 0) {
  return {
    x: finite(state.x),
    y: finite(state.y),
    z: finite(state.z),
    yaw: finite(state.yaw),
    pitch: finite(state.pitch),
    vx: finite(state.vx),
    vz: finite(state.vz),
    seq: state.seq ?? seq,
  };
}

function playerFromSnapshot(players, seat) {
  return players?.[seat] ?? players?.[String(seat)] ?? null;
}

export class NetGameBridge {
  constructor({
    bus,
    attention,
    inputRouter = null,
    getLocalState = null,
    applyRemoteState = null,
    applyAttention = null,
    transportFactory = null,
    latency = LatencySimulator.fromLocation(),
  } = {}) {
    this.bus = bus;
    this.attention = attention;
    this.inputRouter = inputRouter;
    this.getLocalState = getLocalState;
    this.applyRemoteState = applyRemoteState;
    this.applyAttention = applyAttention;
    this.transportFactory = transportFactory;
    this.latency = latency;

    this.session = null;
    this.transport = null;
    this.active = false;
    this.isHost = false;
    this.localSeat = 0;
    this.remoteSeat = 1;
    this.roomId = '';
    this.rttMs = 0;

    this._localInputSeq = 0;
    this._snapshotId = 0;
    this._remoteStates = new Map();
    this._transportUnsubs = [];
    this._busUnsubs = [
      this.bus?.on?.('attention:transfer', (payload) => this._handleAttentionTransfer(payload)),
      this.bus?.on?.('net:remote-input', (payload) => this._handleRemoteInput(payload)),
      this.bus?.on?.('net:snapshot', (snap) => this._handleSnapshot(snap)),
      this.bus?.on?.('net:event', (event) => this._handleNetEvent(event)),
      this.bus?.on?.('net:welcome', (payload) => this._handleWelcome(payload)),
      this.bus?.on?.('net:rtt', ({ rttMs }) => {
        this.rttMs = rttMs;
      }),
    ].filter(Boolean);
  }

  async host() {
    this._beginSession({ isHost: true, localSeat: 0 });
    this.transport = this._createTransport();
    this._bindTransport();
    this.session.attachTransport((raw) => this.transport.send(raw));
    this.roomId = await this.transport.host();
    this.bus?.emit?.('net:room', { roomId: this.roomId });
    return this.roomId;
  }

  async join(roomId) {
    this._beginSession({ isHost: false, localSeat: 1 });
    this.transport = this._createTransport();
    this._bindTransport();
    this.session.attachTransport((raw) => this.transport.send(raw));
    this.roomId = await this.transport.join(roomId);
    return this.roomId;
  }

  update(dt) {
    if (!this.active || !this.session) return;

    this.session.update(dt);
    if (this.isHost) {
      this.attention?.update?.(dt);
      this._applyAttention(this.attention?.snapshot?.());
      this.session.maybeBroadcast(dt, () => this._buildSnapshot());
      return;
    }

    if (this.session.connected) {
      const input = this._readLocalInput(dt);
      const state = this._readLocalState(input.seq);
      this.session.sendLocalInput(input, state);
    }
  }

  sendAttentionSpike(amount, seat = this.localSeat) {
    const value = Math.max(0, Number(amount) || 0);
    if (!this.active || value <= 0) return;
    if (this.isHost) {
      this.attention?.spikeToward?.(seat, value);
      this._applyAttention(this.attention?.snapshot?.());
      return;
    }
    this.session?.send(MSG.EVENT, {
      event: { type: 'attention:spike', seat: this.localSeat, amount: value },
    });
  }

  setAttentionTransfer(dir, seat = this.localSeat) {
    this._handleAttentionTransfer({ dir, seat });
  }

  disconnect(reason = 'local-disconnect') {
    if (this.session?.connected) this.session.send(MSG.LEAVE, { reason });
    this.transport?.disconnect?.(reason);
    this.transport?.dispose?.({ silent: true });
    this._clearTransport();
    this.session = null;
    this.active = false;
    this._remoteStates.clear();
    this.bus?.emit?.('net:status', { state: 'idle', reason });
  }

  dispose() {
    this.disconnect('disposed');
    for (const off of this._busUnsubs) off?.();
    this._busUnsubs = [];
  }

  _beginSession({ isHost, localSeat }) {
    this.disconnect('restart');
    this.active = true;
    this.isHost = isHost;
    this.localSeat = localSeat;
    this.remoteSeat = localSeat === 0 ? 1 : 0;
    this._localInputSeq = 0;
    this._snapshotId = 0;
    this._remoteStates.clear();
    this.session = new NetSession({
      bus: this.bus,
      attention: this.attention,
      isHost,
      localSeat,
    });
    this.bus?.emit?.('net:status', {
      state: isHost ? 'hosting' : 'joining',
      isHost,
      localSeat,
      remoteSeat: this.remoteSeat,
    });
    this._applyAttention(this.attention?.snapshot?.());
  }

  _createTransport() {
    if (this.transportFactory) return this.transportFactory({ latency: this.latency });
    return new PeerTransport({ latency: this.latency });
  }

  _bindTransport() {
    this._clearTransport();
    this._transportUnsubs = [
      this.transport.on('message', (raw) => this.session?.handleMessage(raw)),
      this.transport.on('connected', ({ remoteId }) => this.session?.onConnected(remoteId)),
      this.transport.on('disconnected', ({ reason }) => {
        this.session?.onDisconnected(reason);
        this._remoteStates.delete(this.remoteSeat);
        this.applyRemoteState?.(this.remoteSeat, null, { present: false, reason });
        if (!this.isHost) {
          const transport = this.transport;
          this.active = false;
          this.session = null;
          this._clearTransport();
          transport?.dispose?.({ silent: true });
          this.bus?.emit?.('net:status', { state: 'solo', reason });
        }
      }),
      this.transport.on('status', (payload) => this.bus?.emit?.('net:status', payload)),
      this.transport.on('room', (payload) => this.bus?.emit?.('net:room', payload)),
      this.transport.on('error', (payload) => this.bus?.emit?.('net:error', payload)),
    ];
  }

  _clearTransport() {
    for (const off of this._transportUnsubs) off?.();
    this._transportUnsubs = [];
  }

  _handleWelcome(payload = {}) {
    if (!this.session || this.isHost) return;
    this.localSeat = this.session.localSeat;
    this.remoteSeat = this.session.remoteSeat;
    this._applyAttention(payload.attention ?? this.attention?.snapshot?.());
    this.bus?.emit?.('net:status', {
      state: 'connected',
      isHost: false,
      localSeat: this.localSeat,
      remoteSeat: this.remoteSeat,
      roomId: this.roomId,
    });
  }

  _handleAttentionTransfer(payload = {}) {
    if (!this.active || !this.session) return;
    const dir = normalizeDir(payload.dir);
    const seat = payload.seat ?? this.localSeat;
    if (this.isHost) {
      this.attention?.setTransferIntent?.(seat, dir);
      return;
    }
    if (!this.session.connected) return;
    this.session.send(MSG.EVENT, {
      event: { type: 'attention:intent', seat: this.localSeat, dir },
    });
  }

  _handleNetEvent(event = {}) {
    if (!this.isHost || !this.active) return;
    if (event.type === 'attention:intent') {
      this.attention?.setTransferIntent?.(event.seat ?? this.remoteSeat, normalizeDir(event.dir));
    } else if (event.type === 'attention:spike') {
      this.attention?.spikeToward?.(event.seat ?? this.remoteSeat, Math.max(0, Number(event.amount) || 0));
      this._applyAttention(this.attention?.snapshot?.());
    }
  }

  _handleRemoteInput(payload = {}) {
    if (!this.isHost || !this.active) return;
    const seat = payload.seat ?? this.remoteSeat;
    const input = { ...payload.input, s: seat };
    const previous = this._remoteStates.get(seat);
    if (previous && input.seq != null && input.seq <= previous.seq) return;

    const next = previous
      ? simulateMovement(previous, input)
      : stateWithSeq(payload.state, input.seq ?? 0);
    next.seq = input.seq ?? next.seq;
    this._remoteStates.set(seat, next);
    this.applyRemoteState?.(seat, next, { authoritative: true, input, local: seat === this.localSeat });
  }

  _handleSnapshot(snap = {}) {
    if (this.isHost || !this.active || !snap) return;
    this._applyAttention(snap.attention ?? this.attention?.snapshot?.());

    const remote = playerFromSnapshot(snap.players, this.remoteSeat);
    if (remote) {
      this.applyRemoteState?.(this.remoteSeat, remote, { authoritative: true, local: false });
    }

    const local = playerFromSnapshot(snap.players, this.localSeat);
    if (local) {
      const corrected = this.session?.predictor?.reconcile?.(local, simulateMovement) ?? local;
      this.applyRemoteState?.(this.localSeat, corrected, {
        authoritative: local,
        reconciled: true,
        local: true,
      });
    }
  }

  _buildSnapshot() {
    const local = this._readLocalState(this._localInputSeq);
    const players = {
      [this.localSeat]: local,
    };
    const remote = this._remoteStates.get(this.remoteSeat);
    if (remote) players[this.remoteSeat] = remote;
    return {
      id: ++this._snapshotId,
      time: nowMs(),
      hostSeat: this.localSeat,
      players,
    };
  }

  _readLocalInput(dt) {
    const seat = this.inputRouter?.seat?.(this.localSeat);
    const raw = seat?.toNet?.() ?? { s: this.localSeat };
    const input = { ...raw };
    input.s = this.localSeat;
    input.dt = dt;
    if (!Number.isFinite(input.seq) || input.seq <= this._localInputSeq) {
      input.seq = ++this._localInputSeq;
    } else {
      this._localInputSeq = input.seq;
    }

    const state = this.getLocalState?.(this.localSeat);
    if (state) {
      input.yaw = finite(state.yaw);
      input.pitch = finite(state.pitch);
    }
    return input;
  }

  _readLocalState(seq = this._localInputSeq) {
    return stateWithSeq(this.getLocalState?.(this.localSeat), seq);
  }

  _applyAttention(snapshot) {
    if (!snapshot) return;
    this.applyAttention?.(snapshot, {
      localSeat: this.localSeat,
      remoteSeat: this.remoteSeat,
      isHost: this.isHost,
    });
  }
}
