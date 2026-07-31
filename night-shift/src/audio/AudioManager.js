/** Lightweight procedural SFX — no asset pipeline required for the slice. */
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.voiceBus = null;
    this.enabled = false;
    this._readyCallbacks = new Set();
    this._noiseBuffers = new Map();
  }

  async unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.enabled = true;
      this._notifyReady();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    this.sfxBus = this._makeBus(0.95);
    this.musicBus = this._makeBus(0.55);
    this.voiceBus = this._makeBus(0.82);
    this.enabled = true;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this._notifyReady();
  }

  onReady(fn) {
    if (typeof fn !== 'function') return () => {};
    this._readyCallbacks.add(fn);
    if (this.ctx && this.enabled) fn(this);
    return () => this._readyCallbacks.delete(fn);
  }

  get output() {
    return this.sfxBus ?? this.master;
  }

  bus(name = 'sfx') {
    if (name === 'music') return this.musicBus ?? this.master;
    if (name === 'voice') return this.voiceBus ?? this.master;
    return this.sfxBus ?? this.master;
  }

  _makeBus(level) {
    const bus = this.ctx.createGain();
    bus.gain.value = level;
    bus.connect(this.master);
    return bus;
  }

  _notifyReady() {
    for (const fn of this._readyCallbacks) fn(this);
  }

  _tone(
    freq,
    dur,
    type = 'square',
    gain = 0.15,
    attack = 0.005,
    decay = 0.08,
    destination = this.output,
    when = null,
  ) {
    if (!this.enabled || !this.ctx) return;
    const t0 = when ?? this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur, attack + decay));
    osc.connect(g);
    g.connect(destination ?? this.output);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    return { osc, gain: g };
  }

  _noise(dur, gain = 0.12, filterFreq = 1200, destination = this.output, when = null, filterType = 'lowpass') {
    if (!this.enabled || !this.ctx) return;
    const t0 = when ?? this.ctx.currentTime;
    const buf = this._makeNoiseBuffer(dur);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.01, dur));
    src.connect(filter);
    filter.connect(g);
    g.connect(destination ?? this.output);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    return { source: src, filter, gain: g };
  }

  _makeNoiseBuffer(dur) {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const key = `${length}`;
    let list = this._noiseBuffers.get(key);
    if (!list) {
      list = [];
      this._noiseBuffers.set(key, list);
    }
    if (list.length > 0) return list[Math.floor(Math.random() * list.length)];

    for (let b = 0; b < 4; b++) {
      const buf = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const env = 1 - i / length;
        data[i] = (Math.random() * 2 - 1) * env;
      }
      list.push(buf);
    }
    return list[0];
  }

  play(name, options = {}) {
    const destination = options.destination ?? this.output;
    switch (name) {
      case 'shot':
        this._noise(0.12, 0.28, 2800, destination);
        this._tone(90, 0.08, 'sawtooth', 0.2, 0.004, 0.08, destination);
        break;
      case 'reload':
        this._tone(220, 0.05, 'square', 0.08, 0.004, 0.04, destination);
        setTimeout(() => this._tone(160, 0.08, 'triangle', 0.1, 0.004, 0.06, destination), 200);
        setTimeout(() => this._tone(280, 0.04, 'square', 0.07, 0.004, 0.04, destination), 900);
        break;
      case 'cough':
        this._noise(0.18, 0.16, 900, destination);
        break;
      case 'can':
        this._tone(640, 0.04, 'triangle', 0.1, 0.002, 0.04, destination);
        this._tone(420, 0.06, 'square', 0.06, 0.002, 0.05, destination);
        break;
      case 'glass':
        this._noise(0.25, 0.22, 4500, destination);
        this._tone(1400, 0.1, 'sine', 0.08, 0.002, 0.12, destination);
        break;
      case 'alarm':
        this._tone(880, 0.2, 'square', 0.12, 0.01, 0.16, destination);
        setTimeout(() => this._tone(660, 0.2, 'square', 0.12, 0.01, 0.16, destination), 220);
        break;
      case 'hit':
        this._noise(0.06, 0.18, 600, destination);
        break;
      case 'melee':
        this._noise(0.08, 0.14, 400, destination);
        this._tone(70, 0.1, 'sawtooth', 0.12, 0.004, 0.08, destination);
        break;
      case 'footstep':
        this._noise(0.04, 0.04, 350, destination);
        break;
      default:
        break;
    }
  }
}
