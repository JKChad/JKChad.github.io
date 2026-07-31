import * as THREE from 'three';

const _pos = new THREE.Vector3();

const TIER_PATTERNS = {
  calm: {
    cooldown: 4.5,
    gain: 0.038,
    syllables: [
      [0.0, 115, 96, 0.18],
      [0.2, 105, 88, 0.16],
    ],
    formant: 620,
  },
  notice: {
    cooldown: 1.4,
    gain: 0.066,
    syllables: [
      [0.0, 145, 188, 0.12],
      [0.14, 175, 158, 0.1],
    ],
    formant: 860,
  },
  suspicious: {
    cooldown: 1.7,
    gain: 0.078,
    syllables: [
      [0.0, 138, 124, 0.13],
      [0.16, 132, 178, 0.12],
      [0.31, 168, 152, 0.16],
    ],
    formant: 760,
  },
  alert: {
    cooldown: 1.1,
    gain: 0.095,
    syllables: [
      [0.0, 210, 164, 0.11],
      [0.13, 176, 126, 0.15],
      [0.31, 185, 205, 0.13],
    ],
    formant: 980,
  },
  combat: {
    cooldown: 0.85,
    gain: 0.115,
    syllables: [
      [0.0, 240, 178, 0.1],
      [0.12, 205, 150, 0.1],
      [0.24, 190, 115, 0.14],
      [0.43, 220, 170, 0.12],
    ],
    formant: 1120,
  },
};

function toVector3(value, out) {
  if (value?.isVector3) return out.copy(value);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return out.set(value.x, value.y, value.z);
  }
  return out.set(0, 1.5, 0);
}

function normalizeTier(value) {
  const tier = String(value ?? '').toLowerCase();
  if (tier === 'combat' || tier === 'loud' || tier === 'chase') return 'combat';
  if (tier === 'alert' || tier === 'spotted') return 'alert';
  if (tier === 'suspicious' || tier === 'investigate' || tier === 'investigating' || tier === 'searchlost') {
    return 'suspicious';
  }
  if (tier === 'notice' || tier === 'alertlook') return 'notice';
  return 'calm';
}

export class GuardBarks {
  constructor(audio, spatial) {
    this.audio = audio;
    this.spatial = spatial;
    this._lastByTier = new Map();
  }

  play(payload = {}) {
    if (!this.audio?.ctx || !this.spatial) return;

    const tier = normalizeTier(payload.tier ?? payload.alertTier ?? payload.state ?? payload.kind);
    const pattern = TIER_PATTERNS[tier] ?? TIER_PATTERNS.calm;
    const nowMs = performance.now();
    const last = this._lastByTier.get(tier) ?? -Infinity;
    if (!payload.force && nowMs - last < pattern.cooldown * 1000) return;
    this._lastByTier.set(tier, nowMs);

    const sourcePosition = payload.position ?? payload.guard?.getEyePosition?.(_pos) ?? payload.guard?.position;
    const position = toVector3(sourcePosition, _pos).clone();
    if (position.y < 1) position.y += 1.45;

    const emitter = this.spatial.createEmitter(position, {
      refDistance: 1.5,
      maxDistance: tier === 'combat' ? 30 : 22,
      rolloffFactor: tier === 'calm' ? 2.1 : 1.35,
      bus: 'voice',
    });
    if (!emitter) return;

    const ctx = this.audio.ctx;
    const base = ctx.currentTime;
    const intensity = Math.min(1.35, Math.max(0.35, payload.intensity ?? 1));
    let end = 0;
    for (const syllable of pattern.syllables) {
      const [offset, startFreq, endFreq, duration] = syllable;
      const jitter = 0.94 + Math.random() * 0.12;
      this._syllable({
        destination: emitter.input,
        startTime: base + offset,
        startFreq: startFreq * jitter,
        endFreq: endFreq * jitter,
        duration,
        gain: pattern.gain * intensity * (0.9 + Math.random() * 0.18),
        formant: pattern.formant * (0.9 + Math.random() * 0.2),
      });
      this.audio._noise(
        Math.min(0.08, duration * 0.65),
        pattern.gain * intensity * 0.18,
        pattern.formant * 1.8,
        emitter.input,
        base + offset,
        'bandpass',
      );
      end = Math.max(end, offset + duration);
    }

    setTimeout(() => emitter.dispose(), (end + 0.75) * 1000);
  }

  _syllable({ destination, startTime, startFreq, endFreq, duration, gain, formant }) {
    const ctx = this.audio.ctx;
    const osc = ctx.createOscillator();
    const formantFilter = ctx.createBiquadFilter();
    const lowpass = ctx.createBiquadFilter();
    const amp = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), startTime + duration);

    formantFilter.type = 'bandpass';
    formantFilter.frequency.setValueAtTime(formant, startTime);
    formantFilter.Q.value = 3.4;
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(2200, startTime);

    amp.gain.setValueAtTime(0.0001, startTime);
    amp.gain.exponentialRampToValueAtTime(gain, startTime + 0.018);
    amp.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(formantFilter);
    formantFilter.connect(lowpass);
    lowpass.connect(amp);
    amp.connect(destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.04);
  }
}
