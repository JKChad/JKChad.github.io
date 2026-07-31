export const PARTNER_STATES = Object.freeze({
  FOLLOW_LEFT: 'follow-left',
  FOLLOW_RIGHT: 'follow-right',
  HOLD_COVER: 'hold-cover',
  WATCH_SECTOR: 'watch-sector',
  DRAW_HEAT: 'draw-heat',
  FADE_BACK: 'fade-back',
  EXTRACT_ESCORT: 'extract-escort',
});

const DEFAULTS = Object.freeze({
  flankOffset: 1.55,
  flankDepth: -1.15,
  sectorOffset: 1.25,
  sectorDepth: -0.65,
  fadeDepth: -2.7,
  drawAhead: 1.65,
  drawFlankOffset: 1.15,
  escortLead: 2.25,
  staleThreatSeconds: 4.5,
  lowPartnerVisibility: 0.24,
  lowLocalVisibility: 0.36,
});

const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });

/**
 * Engine-agnostic local AI for the temporary partner seat.
 * It emits simple, named intents so P1 can predict what the ghost is doing.
 */
export class PartnerBrain {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.followSide = options.followSide === 'right' ? 1 : -1;
    this.state = this.followSide < 0 ? PARTNER_STATES.FOLLOW_LEFT : PARTNER_STATES.FOLLOW_RIGHT;
    this.lastKnownThreat = null;
    this.lastThreatAge = Number.POSITIVE_INFINITY;
    this.lastPlayerYaw = 0;
  }

  tick(input = {}) {
    const playerPos = pointFrom(input.playerPos) ?? ZERO;
    const playerYaw = finite(input.playerYaw) ? input.playerYaw : this.lastPlayerYaw;
    this.lastPlayerYaw = playerYaw;

    const dt = finite(input.dt) ? Math.max(0, input.dt) : 0;
    this.lastThreatAge += dt;

    const currentThreat = this._selectThreat(input, playerPos);
    if (currentThreat) {
      this.lastKnownThreat = currentThreat;
      this.lastThreatAge = 0;
    }

    const threatPos =
      currentThreat ??
      (this.lastThreatAge <= this.options.staleThreatSeconds ? this.lastKnownThreat : null);
    const hasCurrentThreat = Boolean(currentThreat);
    const hasThreatMemory = Boolean(threatPos);

    const partnerVis = clamp01(
      firstFinite(
        input.attentionPartnerVis,
        input.partnerVisibility,
        input.attention?.partnerVisibility,
        0.5,
      ),
    );
    const localVis = clamp01(
      firstFinite(
        input.attentionLocalVis,
        input.localVisibility,
        input.attention?.localVisibility,
        1 - partnerVis,
      ),
    );

    const mode = String(input.mode ?? 'stealth').toLowerCase();
    const loud = mode === 'loud' || mode === 'combat';
    const requestedState = requestedPartnerState(
      input.partnerState ?? input.partnerMode ?? input.intent ?? input.mode,
    );
    const extractPos = pointFrom(input.extractPos);
    const wantsExtract =
      Boolean(extractPos) &&
      (requestedState === PARTNER_STATES.EXTRACT_ESCORT ||
        mode === 'extract' ||
        mode === 'exfil' ||
        mode === 'extraction' ||
        mode === 'escape' ||
        input.extract === true ||
        input.extracting === true ||
        input.extractActive === true ||
        input.objective === 'extract');

    const coverPoints = pointList(input.coverPoints);
    const shadowPoints = pointList(input.shadowPoints);
    const lightPoints = pointList(input.lightPoints ?? input.brightPoints);

    let state;
    if (requestedState === PARTNER_STATES.FOLLOW_LEFT) {
      this.followSide = -1;
      state = PARTNER_STATES.FOLLOW_LEFT;
    } else if (requestedState === PARTNER_STATES.FOLLOW_RIGHT) {
      this.followSide = 1;
      state = PARTNER_STATES.FOLLOW_RIGHT;
    } else if (wantsExtract) {
      state = PARTNER_STATES.EXTRACT_ESCORT;
    } else if (requestedState === PARTNER_STATES.FADE_BACK) {
      state = PARTNER_STATES.FADE_BACK;
    } else if (requestedState === PARTNER_STATES.DRAW_HEAT && hasThreatMemory) {
      state = PARTNER_STATES.DRAW_HEAT;
    } else if (requestedState === PARTNER_STATES.HOLD_COVER && coverPoints.length > 0) {
      state = PARTNER_STATES.HOLD_COVER;
    } else if (requestedState === PARTNER_STATES.WATCH_SECTOR && hasThreatMemory) {
      state = PARTNER_STATES.WATCH_SECTOR;
    } else if (partnerVis <= this.options.lowPartnerVisibility) {
      state = PARTNER_STATES.FADE_BACK;
    } else if (hasCurrentThreat && localVis <= this.options.lowLocalVisibility) {
      state = PARTNER_STATES.DRAW_HEAT;
    } else if (hasCurrentThreat && coverPoints.length > 0) {
      state = PARTNER_STATES.HOLD_COVER;
    } else if (hasThreatMemory) {
      state = PARTNER_STATES.WATCH_SECTOR;
    } else {
      this.followSide = this._chooseFollowSide(input, playerPos, playerYaw, threatPos);
      state = this.followSide < 0 ? PARTNER_STATES.FOLLOW_LEFT : PARTNER_STATES.FOLLOW_RIGHT;
    }

    this.state = state;
    const targetPos = this._targetForState({
      state,
      playerPos,
      playerYaw,
      partnerPos: pointFrom(input.partnerPos),
      threatPos,
      coverPoints,
      shadowPoints,
      lightPoints,
      extractPos,
    });

    const facePos = this._facePointForState(state, playerPos, targetPos, threatPos, extractPos);
    return {
      targetPos,
      faceYaw: yawToward(targetPos, facePos),
      state,
      wantDistract: state === PARTNER_STATES.DRAW_HEAT,
      wantFire:
        loud &&
        hasThreatMemory &&
        state !== PARTNER_STATES.FADE_BACK &&
        state !== PARTNER_STATES.DRAW_HEAT,
    };
  }

  _targetForState({
    state,
    playerPos,
    playerYaw,
    partnerPos,
    threatPos,
    coverPoints,
    shadowPoints,
    lightPoints,
    extractPos,
  }) {
    switch (state) {
      case PARTNER_STATES.HOLD_COVER:
        return clampToBounds(
          nearestPoint(coverPoints, partnerPos ?? playerPos) ?? this._sectorTarget(playerPos, playerYaw, threatPos),
          this.options.bounds,
        );

      case PARTNER_STATES.WATCH_SECTOR:
        return clampToBounds(this._sectorTarget(playerPos, playerYaw, threatPos), this.options.bounds);

      case PARTNER_STATES.DRAW_HEAT:
        return clampToBounds(
          this._drawHeatTarget(playerPos, playerYaw, threatPos, lightPoints),
          this.options.bounds,
        );

      case PARTNER_STATES.FADE_BACK:
        return clampToBounds(
          nearestPoint(shadowPoints, partnerPos ?? playerPos) ??
            this._fadeBackTarget(playerPos, playerYaw, threatPos),
          this.options.bounds,
        );

      case PARTNER_STATES.EXTRACT_ESCORT:
        return clampToBounds(this._extractTarget(playerPos, extractPos), this.options.bounds);

      case PARTNER_STATES.FOLLOW_RIGHT:
        return clampToBounds(this._flankTarget(playerPos, playerYaw, 1), this.options.bounds);

      case PARTNER_STATES.FOLLOW_LEFT:
      default:
        return clampToBounds(this._flankTarget(playerPos, playerYaw, -1), this.options.bounds);
    }
  }

  _selectThreat(input, playerPos) {
    const candidates = [];
    const guardPos = pointFrom(input.guardPos);
    if (guardPos) candidates.push({ pos: guardPos, priority: 1 });

    const threats = Array.isArray(input.threats) ? input.threats : [];
    for (const threat of threats) {
      if (threat?.active === false || threat?.alive === false || threat?.dead === true) continue;
      const pos = pointFrom(
        threat?.lastKnownPos ??
          threat?.lastSeenPos ??
          threat?.position ??
          threat?.pos ??
          threat?.point ??
          threat,
      );
      if (!pos) continue;
      candidates.push({
        pos,
        priority: firstFinite(threat?.priority, threat?.confidence, threat?.suspicion, 0.5),
      });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const priorityDelta = b.priority - a.priority;
      if (Math.abs(priorityDelta) > 0.001) return priorityDelta;
      return distanceSqXZ(a.pos, playerPos) - distanceSqXZ(b.pos, playerPos);
    });
    return clonePoint(candidates[0].pos);
  }

  _chooseFollowSide(input, playerPos, playerYaw, threatPos) {
    const requestedSide = String(input.followSide ?? input.flankSide ?? '').toLowerCase();
    if (requestedSide === 'left') return -1;
    if (requestedSide === 'right') return 1;

    if (threatPos) {
      const threatSide = signedSide(playerPos, playerYaw, threatPos);
      if (Math.abs(threatSide) > 0.15) return threatSide > 0 ? -1 : 1;
    }

    const left = clampToBounds(this._flankTarget(playerPos, playerYaw, -1), this.options.bounds);
    const right = clampToBounds(this._flankTarget(playerPos, playerYaw, 1), this.options.bounds);
    const leftClamped = distanceSqXZ(left, this._flankTarget(playerPos, playerYaw, -1));
    const rightClamped = distanceSqXZ(right, this._flankTarget(playerPos, playerYaw, 1));
    if (Math.abs(leftClamped - rightClamped) > 0.01) return leftClamped < rightClamped ? -1 : 1;

    return this.followSide;
  }

  _flankTarget(playerPos, playerYaw, side) {
    const forward = forwardFromYaw(playerYaw);
    const right = rightFromYaw(playerYaw);
    return {
      x: playerPos.x + right.x * this.options.flankOffset * side + forward.x * this.options.flankDepth,
      y: groundY(playerPos),
      z: playerPos.z + right.z * this.options.flankOffset * side + forward.z * this.options.flankDepth,
    };
  }

  _sectorTarget(playerPos, playerYaw, threatPos) {
    const side = threatPos ? (signedSide(playerPos, playerYaw, threatPos) > 0 ? -1 : 1) : this.followSide;
    const forward = forwardFromYaw(playerYaw);
    const right = rightFromYaw(playerYaw);
    return {
      x: playerPos.x + right.x * this.options.sectorOffset * side + forward.x * this.options.sectorDepth,
      y: groundY(playerPos),
      z: playerPos.z + right.z * this.options.sectorOffset * side + forward.z * this.options.sectorDepth,
    };
  }

  _drawHeatTarget(playerPos, playerYaw, threatPos, lightPoints) {
    const lightTarget = nearestPoint(
      lightPoints.filter((point) => distanceSqXZ(point, playerPos) <= 36),
      threatPos ?? playerPos,
    );
    if (lightTarget) return lightTarget;

    const toThreat = normalizeXZ(subXZ(threatPos ?? aheadPoint(playerPos, playerYaw, 4), playerPos));
    const side =
      threatPos && Math.abs(signedSide(playerPos, playerYaw, threatPos)) > 0.2
        ? Math.sign(signedSide(playerPos, playerYaw, threatPos))
        : -this.followSide;
    const right = rightFromYaw(playerYaw);
    return {
      x:
        playerPos.x +
        toThreat.x * this.options.drawAhead +
        right.x * this.options.drawFlankOffset * side,
      y: groundY(playerPos),
      z:
        playerPos.z +
        toThreat.z * this.options.drawAhead +
        right.z * this.options.drawFlankOffset * side,
    };
  }

  _fadeBackTarget(playerPos, playerYaw, threatPos) {
    const forward = forwardFromYaw(playerYaw);
    const right = rightFromYaw(playerYaw);
    const side = threatPos ? (signedSide(playerPos, playerYaw, threatPos) > 0 ? -1 : 1) : this.followSide;
    return {
      x: playerPos.x + forward.x * this.options.fadeDepth + right.x * side,
      y: groundY(playerPos),
      z: playerPos.z + forward.z * this.options.fadeDepth + right.z * side,
    };
  }

  _extractTarget(playerPos, extractPos) {
    if (!extractPos) return clonePoint(playerPos);
    const toExtract = subXZ(extractPos, playerPos);
    const distance = Math.hypot(toExtract.x, toExtract.z);
    if (distance <= this.options.escortLead) return clonePoint(extractPos);

    const dir = normalizeXZ(toExtract);
    return {
      x: playerPos.x + dir.x * this.options.escortLead,
      y: groundY(playerPos),
      z: playerPos.z + dir.z * this.options.escortLead,
    };
  }

  _facePointForState(state, playerPos, targetPos, threatPos, extractPos) {
    if (
      threatPos &&
      state !== PARTNER_STATES.FOLLOW_LEFT &&
      state !== PARTNER_STATES.FOLLOW_RIGHT
    ) {
      return threatPos;
    }
    if (state === PARTNER_STATES.EXTRACT_ESCORT && extractPos) return extractPos;
    if (state === PARTNER_STATES.FADE_BACK && threatPos) return threatPos;
    if (state === PARTNER_STATES.FOLLOW_LEFT || state === PARTNER_STATES.FOLLOW_RIGHT) {
      return aheadPoint(playerPos, this.lastPlayerYaw, 3);
    }
    return playerPos ?? targetPos;
  }
}

function pointFrom(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    const [x, y = 0, z = 0] = value;
    return finite(x) && finite(z) ? { x, y: finite(y) ? y : 0, z } : null;
  }
  const source = value.position ?? value.pos ?? value.point ?? value.worldPosition ?? value;
  const x = source?.x;
  const y = source?.y ?? 0;
  const z = source?.z;
  if (!finite(x) || !finite(z)) return null;
  return { x, y: finite(y) ? y : 0, z };
}

function pointList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(pointFrom).filter(Boolean);
}

function requestedPartnerState(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  return Object.values(PARTNER_STATES).includes(normalized) ? normalized : null;
}

function nearestPoint(points, reference) {
  if (!Array.isArray(points) || points.length === 0 || !reference) return null;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = distanceSqXZ(point, reference);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best ? clonePoint(best) : null;
}

function clonePoint(point) {
  return { x: point.x, y: point.y ?? 0, z: point.z };
}

function clampToBounds(point, bounds) {
  if (!bounds) return clonePoint(point);
  return {
    x: clamp(point.x, firstFinite(bounds.minX, bounds.xMin, -Number.MAX_VALUE), firstFinite(bounds.maxX, bounds.xMax, Number.MAX_VALUE)),
    y: point.y ?? 0,
    z: clamp(point.z, firstFinite(bounds.minZ, bounds.zMin, -Number.MAX_VALUE), firstFinite(bounds.maxZ, bounds.zMax, Number.MAX_VALUE)),
  };
}

function forwardFromYaw(yaw) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

function rightFromYaw(yaw) {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

function yawToward(from, to) {
  if (!from || !to) return 0;
  return Math.atan2(to.x - from.x, to.z - from.z);
}

function signedSide(origin, yaw, point) {
  const right = rightFromYaw(yaw);
  return (point.x - origin.x) * right.x + (point.z - origin.z) * right.z;
}

function aheadPoint(origin, yaw, distance) {
  const forward = forwardFromYaw(yaw);
  return {
    x: origin.x + forward.x * distance,
    y: groundY(origin),
    z: origin.z + forward.z * distance,
  };
}

function subXZ(a, b) {
  return { x: (a?.x ?? 0) - (b?.x ?? 0), z: (a?.z ?? 0) - (b?.z ?? 0) };
}

function normalizeXZ(v) {
  const length = Math.hypot(v.x, v.z);
  if (length <= 0.0001) return { x: 0, z: -1 };
  return { x: v.x / length, z: v.z / length };
}

function distanceSqXZ(a, b) {
  const dx = (a?.x ?? 0) - (b?.x ?? 0);
  const dz = (a?.z ?? 0) - (b?.z ?? 0);
  return dx * dx + dz * dz;
}

function groundY(point) {
  return finite(point?.y) ? point.y : 0;
}

function firstFinite(...values) {
  return values.find(finite);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
