import * as THREE from 'three';

const _pos = new THREE.Vector3();

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function toVector3(value, out) {
  if (value?.isVector3) return out.copy(value);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return out.set(value.x, value.y, value.z);
  }
  return out.set(0, 0, 0);
}

function normalizeSurface(surface) {
  const value = String(surface ?? '').toLowerCase();
  if (value.includes('metal') || value.includes('steel')) return 'metal';
  if (value.includes('fabric') || value.includes('cloth') || value.includes('paper') || value.includes('vinyl')) {
    return 'fabric';
  }
  return 'concrete';
}

export class Footsteps {
  constructor(audio, spatial, options = {}) {
    this.audio = audio;
    this.spatial = spatial;
    this.sampleSurface = options.sampleSurface ?? (() => 'concrete');
    this._side = 0;
  }

  play(payload = {}) {
    if (!this.audio?.ctx || !this.spatial) return;

    const position = toVector3(payload.position ?? payload.origin, _pos).clone();
    position.y += 0.08;
    const surface = normalizeSurface(payload.surface ?? this.sampleSurface(position));
    const loudness = clamp01(payload.loudness ?? 0.55);
    const emitter = this.spatial.createEmitter(position, {
      refDistance: 0.9,
      maxDistance: 16,
      rolloffFactor: 1.75,
      bus: 'sfx',
    });
    if (!emitter) return;

    this._side = 1 - this._side;
    const humanize = 0.88 + Math.random() * 0.24;
    const gain = (0.035 + loudness * 0.075) * humanize;
    const t = this.audio.ctx.currentTime;

    if (surface === 'metal') {
      this.audio._noise(0.045, gain * 0.9, 2400 + Math.random() * 900, emitter.input, t, 'bandpass');
      this.audio._tone(520 + this._side * 120 + Math.random() * 80, 0.075, 'triangle', gain * 0.55, 0.002, 0.08, emitter.input, t);
      this.audio._tone(1180 + Math.random() * 160, 0.035, 'sine', gain * 0.24, 0.001, 0.05, emitter.input, t + 0.012);
    } else if (surface === 'fabric') {
      this.audio._noise(0.06, gain * 0.58, 420 + Math.random() * 140, emitter.input, t, 'lowpass');
      this.audio._tone(72 + Math.random() * 24, 0.045, 'sine', gain * 0.18, 0.004, 0.05, emitter.input, t);
    } else {
      this.audio._noise(0.045, gain, 720 + Math.random() * 180, emitter.input, t, 'lowpass');
      this.audio._noise(0.032, gain * 0.36, 1550 + Math.random() * 500, emitter.input, t + 0.01, 'bandpass');
      this.audio._tone(92 + Math.random() * 18, 0.04, 'sine', gain * 0.22, 0.003, 0.05, emitter.input, t);
    }

    setTimeout(() => emitter.dispose(), 650);
  }
}
