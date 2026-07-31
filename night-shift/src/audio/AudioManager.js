/** Lightweight procedural SFX — no asset pipeline required for the slice. */
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;
  }

  async unlock() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    this.enabled = true;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  _tone(freq, dur, type = 'square', gain = 0.15, attack = 0.005, decay = 0.08) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur, attack + decay));
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  _noise(dur, gain = 0.12, filterFreq = 1200) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
  }

  play(name) {
    switch (name) {
      case 'shot':
        this._noise(0.12, 0.28, 2800);
        this._tone(90, 0.08, 'sawtooth', 0.2);
        break;
      case 'reload':
        this._tone(220, 0.05, 'square', 0.08);
        setTimeout(() => this._tone(160, 0.08, 'triangle', 0.1), 200);
        setTimeout(() => this._tone(280, 0.04, 'square', 0.07), 900);
        break;
      case 'cough':
        this._noise(0.18, 0.16, 900);
        break;
      case 'can':
        this._tone(640, 0.04, 'triangle', 0.1);
        this._tone(420, 0.06, 'square', 0.06);
        break;
      case 'glass':
        this._noise(0.25, 0.22, 4500);
        this._tone(1400, 0.1, 'sine', 0.08);
        break;
      case 'alarm':
        this._tone(880, 0.2, 'square', 0.12);
        setTimeout(() => this._tone(660, 0.2, 'square', 0.12), 220);
        break;
      case 'hit':
        this._noise(0.06, 0.18, 600);
        break;
      case 'melee':
        this._noise(0.08, 0.14, 400);
        this._tone(70, 0.1, 'sawtooth', 0.12);
        break;
      case 'footstep':
        this._noise(0.04, 0.04, 350);
        break;
      default:
        break;
    }
  }
}
