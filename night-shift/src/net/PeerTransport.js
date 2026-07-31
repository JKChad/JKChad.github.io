import { Peer } from 'peerjs';
import { LatencySimulator } from './LatencySimulator.js';

const ROOM_PREFIX = 'night-shift';
const DEFAULT_HOST = undefined;

function makeRoomId() {
  const bytes = new Uint8Array(4);
  globalThis.crypto?.getRandomValues?.(bytes);
  const value =
    bytes.some(Boolean)
      ? Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('')
      : Math.random().toString(36).slice(2, 10);
  return `${ROOM_PREFIX}-${value.slice(0, 8)}`.toLowerCase();
}

function cleanRoomId(roomId) {
  return String(roomId || '').trim().toLowerCase();
}

export class PeerTransport {
  constructor({ bus = null, peerFactory = null, peerOptions = {}, latency = null } = {}) {
    this.bus = bus;
    this.peerFactory = peerFactory;
    this.peerOptions = peerOptions;
    this.latency = latency ?? LatencySimulator.fromLocation();
    this.peer = null;
    this.conn = null;
    this.roomId = '';
    this.peerId = '';
    this.remoteId = '';
    this.state = 'idle';
    this._listeners = new Map();
  }

  on(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this._listeners.get(type)?.delete(fn);
  }

  async host(roomId = makeRoomId()) {
    this.dispose({ silent: true });
    this.roomId = cleanRoomId(roomId) || makeRoomId();
    this.state = 'opening';
    this._emit('status', { state: this.state, roomId: this.roomId });

    this.peer = this._createPeer(this.roomId);
    this._bindPeer();
    await this._waitForOpen();
    this.state = 'waiting';
    this._emit('room', { roomId: this.roomId, peerId: this.peerId });
    this._emit('status', { state: this.state, roomId: this.roomId, peerId: this.peerId });
    return this.roomId;
  }

  async join(roomId) {
    this.dispose({ silent: true });
    this.roomId = cleanRoomId(roomId);
    if (!this.roomId) throw new Error('Missing room code');

    this.state = 'opening';
    this._emit('status', { state: this.state, roomId: this.roomId });
    this.peer = this._createPeer();
    this._bindPeer();
    await this._waitForOpen();

    this.state = 'connecting';
    this._emit('status', { state: this.state, roomId: this.roomId, peerId: this.peerId });
    this._attachConnection(this.peer.connect(this.roomId, { reliable: true }), { outgoing: true });
    await this._waitForConnectionOpen();
    return this.roomId;
  }

  send(payload) {
    if (!this.conn?.open) return false;
    return this.latency
      ? this.latency.schedule((data) => this.conn?.open && this.conn.send(data), payload)
      : (this.conn.send(payload), true);
  }

  disconnect(reason = 'local-disconnect') {
    if (this.conn?.open) {
      try {
        this.conn.send(JSON.stringify({ t: 'leave', reason }));
      } catch {
        // Best-effort courtesy frame before closing.
      }
    }
    this.conn?.close?.();
    this._handleDisconnect(reason);
  }

  dispose({ silent = false } = {}) {
    this.latency?.dispose?.();
    this.conn?.close?.();
    this.peer?.destroy?.();
    this.conn = null;
    this.peer = null;
    this.remoteId = '';
    this.peerId = '';
    if (!silent && this.state !== 'idle') this._handleDisconnect('disposed');
    this.state = 'idle';
  }

  _createPeer(id = undefined) {
    const factory = this.peerFactory ?? ((peerId, options) => new Peer(peerId, options));
    const options = { host: DEFAULT_HOST, ...this.peerOptions };
    return id ? factory(id, options) : factory(undefined, options);
  }

  _bindPeer() {
    this.peer.on('open', (id) => {
      this.peerId = id;
      this._emit('open', { peerId: id, roomId: this.roomId });
    });
    this.peer.on('connection', (conn) => {
      if (this.conn && this.conn !== conn) {
        conn.close();
        return;
      }
      this._attachConnection(conn, { outgoing: false });
    });
    this.peer.on('error', (error) => {
      this.state = 'error';
      this._emit('error', { error, message: error?.message || String(error) });
      this._emit('status', { state: this.state, error: error?.message || String(error), roomId: this.roomId });
    });
    this.peer.on('disconnected', () => {
      this._emit('status', { state: 'broker-disconnected', roomId: this.roomId });
    });
  }

  _attachConnection(conn, { outgoing }) {
    this.conn = conn;
    this.remoteId = conn.peer;
    conn.on('open', () => {
      this.state = 'connected';
      this.remoteId = conn.peer;
      this._emit('connected', { remoteId: this.remoteId, outgoing });
      this._emit('status', {
        state: this.state,
        roomId: this.roomId,
        peerId: this.peerId,
        remoteId: this.remoteId,
      });
    });
    conn.on('data', (data) => {
      const deliver = (payload) => this._emit('message', payload);
      if (this.latency) this.latency.schedule(deliver, data);
      else deliver(data);
    });
    conn.on('close', () => this._handleDisconnect('peer-left'));
    conn.on('error', (error) => {
      this._emit('error', { error, message: error?.message || String(error) });
      this._handleDisconnect('connection-error');
    });
  }

  _waitForOpen() {
    if (this.peer?.open) return Promise.resolve(this.peerId || this.peer.id);
    return new Promise((resolve, reject) => {
      const offOpen = this.on('open', ({ peerId }) => {
        cleanup();
        resolve(peerId);
      });
      const offError = this.on('error', ({ error, message }) => {
        cleanup();
        reject(error || new Error(message));
      });
      const cleanup = () => {
        offOpen();
        offError();
      };
    });
  }

  _waitForConnectionOpen() {
    if (this.conn?.open) return Promise.resolve(this.conn.peer);
    return new Promise((resolve, reject) => {
      const offConnected = this.on('connected', ({ remoteId }) => {
        cleanup();
        resolve(remoteId);
      });
      const offError = this.on('error', ({ error, message }) => {
        cleanup();
        reject(error || new Error(message));
      });
      const cleanup = () => {
        offConnected();
        offError();
      };
    });
  }

  _handleDisconnect(reason) {
    const wasActive = this.state !== 'idle' && this.state !== 'waiting';
    this.conn = null;
    this.remoteId = '';
    this.state = this.peer ? 'waiting' : 'idle';
    if (wasActive) this._emit('disconnected', { reason });
    this._emit('status', { state: this.state, reason, roomId: this.roomId, peerId: this.peerId });
  }

  _emit(type, payload = {}) {
    this.bus?.emit?.(`net:${type}`, payload);
    const listeners = this._listeners.get(type);
    if (!listeners) return;
    for (const fn of listeners) fn(payload);
  }
}
