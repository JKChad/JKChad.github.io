import { clamp, saturate, smoothstep, distanceXZ, dot3, normalize3, sub3, vec3 } from '../math/index.js';

/**
 * Engine-agnostic alert / suspicion tiers.
 * States a human can plan around:
 *  calm → notice → suspicious → investigating → alert → searching → combat → cooling
 */
export const ALERT = {
  CALM: 'calm',
  NOTICE: 'notice',
  SUSPICIOUS: 'suspicious',
  INVESTIGATING: 'investigating',
  ALERT: 'alert',
  SEARCHING: 'searching',
  COMBAT: 'combat',
  COOLING: 'cooling',
};

export const ALERT_ORDER = [
  ALERT.CALM,
  ALERT.NOTICE,
  ALERT.SUSPICIOUS,
  ALERT.INVESTIGATING,
  ALERT.ALERT,
  ALERT.SEARCHING,
  ALERT.COMBAT,
  ALERT.COOLING,
];

export class AlertBrain {
  constructor(id, { bus = null } = {}) {
    this.id = id;
    this.bus = bus;
    this.tier = ALERT.CALM;
    this.suspicion = 0;
    this.confidence = 0;
    this.lastSeen = null; // { x,y,z, t }
    this.lastHeard = null;
    this.checkCalled = false;
    this.quietTime = 0;
    this.bodyKnown = false;
  }

  setTier(tier, reason = '') {
    if (this.tier === tier) return;
    const prev = this.tier;
    this.tier = tier;
    this.bus?.emit('alert:tier', { id: this.id, prev, tier, reason });
  }

  /** Accumulate perception score 0..1 */
  ingestPerception(score, dt, { seenPos = null } = {}) {
    if (score > 0.02) {
      this.quietTime = 0;
      this.suspicion = clamp(this.suspicion + score * dt * 1.1, 0, 1);
      this.confidence = clamp(this.confidence + score * dt * 0.9, 0, 1);
      if (seenPos) this.lastSeen = { ...seenPos, kind: 'sighting', t: 0 };
    } else {
      this.quietTime += dt;
      this.suspicion = clamp(this.suspicion - dt * 0.12, 0, 1);
      this.confidence = clamp(this.confidence - dt * 0.08, 0, 1);
      if (this.lastSeen) this.lastSeen.t += dt;
    }
    this._reevaluate('perception');
  }

  hear(pos, kind = 'noise', intensity = 0.5) {
    const heardIntensity = clamp(intensity, 0, 1);
    this.lastHeard = { ...pos, kind, intensity: heardIntensity, t: 0 };
    this.quietTime = 0;
    this.suspicion = clamp(this.suspicion + heardIntensity * 0.35, 0, 1);

    if (isLoudSound(kind) && heardIntensity >= 0.15) {
      this.setTier(ALERT.ALERT, kind);
    } else if (heardIntensity >= 0.18 && (this.tier === ALERT.CALM || this.tier === ALERT.NOTICE)) {
      this.setTier(ALERT.SUSPICIOUS, kind);
    } else if (this.tier === ALERT.COOLING) {
      this.setTier(ALERT.INVESTIGATING, kind);
    } else {
      this._reevaluate(kind);
    }
  }

  /** Found body — escalates and should propagate via GuardNetwork. */
  findBody(pos) {
    this.bodyKnown = true;
    this.suspicion = 1;
    this.setTier(ALERT.ALERT, 'body');
    this.lastSeen = { ...pos, kind: 'body', t: 0 };
    this.bus?.emit('alert:body-found', { id: this.id, pos });
  }

  callCheck() {
    if (this.checkCalled) return false;
    if (this.suspicion < 0.45 && this.tier !== ALERT.INVESTIGATING) return false;
    this.checkCalled = true;
    this.bus?.emit('alert:check-called', { id: this.id, pos: this.lastSeen || this.lastHeard });
    return true;
  }

  enterCombat(reason = 'spotted') {
    this.setTier(ALERT.COMBAT, reason);
    this.suspicion = 1;
  }

  /** Sustained quiet de-escalates. */
  update(dt) {
    if (this.lastHeard) this.lastHeard.t += dt;
    if (this.tier === ALERT.COMBAT) return;

    if (this.quietTime > 8 && this.tier !== ALERT.CALM) {
      this.setTier(ALERT.COOLING, 'quiet');
    }
    if (this.quietTime > 16 && this.suspicion < 0.1) {
      this.setTier(ALERT.CALM, 'clear');
      this.checkCalled = false;
      this.bodyKnown = false;
    }
    if (this.tier === ALERT.COOLING && this.suspicion > 0.35) {
      this.setTier(ALERT.SEARCHING, 'reheat');
    }
  }

  _reevaluate(reason) {
    if (this.tier === ALERT.COMBAT) return;
    if ((this.tier === ALERT.ALERT || this.tier === ALERT.SEARCHING) && this.quietTime <= 8) return;
    if (this.suspicion >= 0.95 && this.confidence >= 0.7) {
      this.setTier(ALERT.ALERT, reason);
      return;
    }
    if (this.suspicion >= 0.55) {
      this.setTier(ALERT.INVESTIGATING, reason);
      return;
    }
    if (this.suspicion >= 0.28) {
      this.setTier(ALERT.SUSPICIOUS, reason);
      return;
    }
    if (this.suspicion >= 0.1) {
      this.setTier(ALERT.NOTICE, reason);
    }
  }
}

function isLoudSound(kind) {
  return kind === 'shot' || kind === 'explosion' || kind === 'alarm';
}

/**
 * Facility-wide alert propagation (radios / shouts).
 */
export class GuardNetwork {
  constructor(bus) {
    this.bus = bus;
    this.brains = new Map();
    this.facilityAlert = 0; // 0..1
    this.bodyReports = [];

    bus?.on('alert:body-found', (e) => this.propagateBody(e));
    bus?.on('alert:check-called', (e) => this.propagateCheck(e));
  }

  register(brain) {
    this.brains.set(brain.id, brain);
  }

  unregister(id) {
    this.brains.delete(id);
  }

  propagateBody({ id, pos }) {
    this.bodyReports.push({ id, pos, t: 0 });
    this.facilityAlert = Math.max(this.facilityAlert, 0.75);
    for (const [otherId, brain] of this.brains) {
      if (otherId === id) continue;
      brain.hear(pos, 'body-radio', 0.85);
      brain.bodyKnown = true;
      if (brain.tier !== ALERT.COMBAT) brain.setTier(ALERT.ALERT, 'body-radio');
    }
    this.bus?.emit('alert:facility', { level: this.facilityAlert, reason: 'body' });
  }

  propagateCheck({ id, pos }) {
    this.facilityAlert = Math.max(this.facilityAlert, 0.4);
    for (const [otherId, brain] of this.brains) {
      if (otherId === id) continue;
      brain.hear(pos || vec3(), 'radio-check', 0.4);
    }
  }

  update(dt) {
    this.facilityAlert = clamp(this.facilityAlert - dt * 0.01, 0, 1);
    for (const r of this.bodyReports) r.t += dt;
    this.bodyReports = this.bodyReports.filter((r) => r.t < 120);
    for (const brain of this.brains.values()) brain.update(dt);
  }
}

/** Pure perception score helper — used by adapters that supply illumination/LOS. */
export function scoreDetection({
  distance,
  viewDistance,
  fovDot,
  fovCos,
  illumination, // 0..1
  lightThreshold = 0.22,
  visibility, // attention 0..1
  flashlightScore = 0,
}) {
  if (distance > viewDistance) return 0;
  if (fovDot < fovCos && flashlightScore < 0.15) return 0;
  const distFalloff = 1 - saturate(distance / viewDistance);
  const fovFalloff = saturate((fovDot - fovCos) / (1 - fovCos + 1e-5));
  const lightTerm = Math.max(
    smoothstep(lightThreshold, 1, illumination),
    flashlightScore,
  );
  // Soft floor when strongly lit by flashlight even if attention is low.
  const vis = flashlightScore > 0.55 ? Math.max(visibility, 0.22) : visibility;
  return saturate(vis * lightTerm * distFalloff * Math.max(fovFalloff, flashlightScore));
}

export function flashlightConeScore({
  origin,
  forward,
  target,
  range,
  fovDeg,
}) {
  const to = normalize3(vec3(), sub3(vec3(), target, origin));
  const dist = distanceXZ(origin, target);
  if (dist > range) return 0;
  const cos = Math.cos((fovDeg * Math.PI) / 180 / 2);
  const d = dot3(forward, to);
  if (d < cos) return 0;
  const ang = saturate((d - cos) / (1 - cos + 1e-5));
  const rng = 1 - saturate(dist / range);
  return saturate(ang * rng);
}
