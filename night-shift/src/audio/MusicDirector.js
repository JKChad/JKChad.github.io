function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function setParam(param, value, time, ramp = 0.08) {
  if (!param) return;
  if (typeof param.setTargetAtTime === 'function') {
    param.setTargetAtTime(value, time, ramp);
  } else {
    param.value = value;
  }
}

export class MusicDirector {
  constructor(audio, options = {}) {
    this.audio = audio;
    this.mode = options.mode ?? 'stealth';
    this.facilityAlert = 0;
    this.localSuspicion = 0;
    this.tension = 0;
    this.targetTension = 0;
    this.started = false;
    this._nodes = null;
    this._nextPulse = 0;

    this.audio?.onReady?.(() => this.start());
  }

  setMode(mode) {
    this.mode = mode === 'loud' ? 'loud' : 'stealth';
  }

  setFacilityAlert(level = 0) {
    this.facilityAlert = clamp01(level);
  }

  setLocalSuspicion(value = 0) {
    this.localSuspicion = clamp01(value);
  }

  update(dt, inputs = {}) {
    if (inputs.mode) this.setMode(inputs.mode);
    if (Number.isFinite(inputs.facilityAlert)) this.setFacilityAlert(inputs.facilityAlert);
    if (Number.isFinite(inputs.localSuspicion)) this.setLocalSuspicion(inputs.localSuspicion);
    if (!this.audio?.ctx) return;
    if (!this.started) this.start();
    if (!this.started) return;

    const modeTerm = this.mode === 'loud' ? 0.58 : 0;
    this.targetTension = clamp01(modeTerm + this.facilityAlert * 0.52 + this.localSuspicion * 0.62);
    this.tension = damp(this.tension, this.targetTension, this.targetTension > this.tension ? 2.8 : 1.25, dt);
    this._applyMix();
    this._scheduleCombatPulse();
  }

  start() {
    if (this.started || !this.audio?.ctx) return;

    const ctx = this.audio.ctx;
    const musicBus = this.audio.bus?.('music') ?? this.audio.master;
    const stealthGain = ctx.createGain();
    const combatGain = ctx.createGain();
    const stealthFilter = ctx.createBiquadFilter();
    const combatFilter = ctx.createBiquadFilter();

    stealthGain.gain.value = 0.08;
    combatGain.gain.value = 0.0001;
    stealthFilter.type = 'lowpass';
    stealthFilter.frequency.value = 1200;
    combatFilter.type = 'lowpass';
    combatFilter.frequency.value = 900;

    stealthFilter.connect(stealthGain);
    combatFilter.connect(combatGain);
    stealthGain.connect(musicBus);
    combatGain.connect(musicBus);

    const droneA = this._osc('sine', 55, stealthFilter, 0.045);
    const droneB = this._osc('triangle', 82.5, stealthFilter, 0.024);
    const air = this._osc('sine', 165, stealthFilter, 0.012);
    const bass = this._osc('sawtooth', 55, combatFilter, 0.032);
    const pulseTone = this._osc('square', 110, combatFilter, 0.018);

    this._nodes = {
      stealthGain,
      combatGain,
      stealthFilter,
      combatFilter,
      oscillators: [droneA, droneB, air, bass, pulseTone],
    };
    this.started = true;
    this._nextPulse = ctx.currentTime + 0.25;
    this._applyMix(true);
  }

  _osc(type, frequency, destination, gainValue) {
    const ctx = this.audio.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.value = gainValue;
    osc.connect(gain);
    gain.connect(destination);
    osc.start();
    return { osc, gain };
  }

  _applyMix(immediate = false) {
    const nodes = this._nodes;
    if (!nodes) return;

    const ctx = this.audio.ctx;
    const t = this.tension;
    const stealthLevel = 0.085 * (1 - t * 0.68);
    const combatLevel = 0.0001 + t * t * 0.145;
    const ramp = immediate ? 0.01 : 0.09;

    setParam(nodes.stealthGain.gain, stealthLevel, ctx.currentTime, ramp);
    setParam(nodes.combatGain.gain, combatLevel, ctx.currentTime, ramp);
    setParam(nodes.stealthFilter.frequency, 1400 - t * 720, ctx.currentTime, 0.16);
    setParam(nodes.combatFilter.frequency, 640 + t * 2100, ctx.currentTime, 0.08);
  }

  _scheduleCombatPulse() {
    const ctx = this.audio.ctx;
    const nodes = this._nodes;
    if (!nodes) return;

    const tension = this.tension;
    if (tension < 0.03) return;
    const interval = 0.62 - tension * 0.28;
    while (ctx.currentTime + 0.08 >= this._nextPulse) {
      const gain = (0.006 + tension * 0.052) * (0.85 + Math.random() * 0.3);
      this._pulse(this._nextPulse, gain);
      this._nextPulse += Math.max(0.24, interval + (Math.random() - 0.5) * 0.045);
    }
  }

  _pulse(when, gainValue) {
    const ctx = this.audio.ctx;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(74, when);
    osc.frequency.exponentialRampToValueAtTime(41, when + 0.18);
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue), when + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
    osc.connect(amp);
    amp.connect(this._nodes.combatFilter);
    osc.start(when);
    osc.stop(when + 0.26);
  }
}
