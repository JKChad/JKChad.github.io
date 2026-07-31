/** @typedef {'stealth' | 'loud'} GameMode */

export const CONFIG = {
  targetFps: 60,
  fixedDt: 1 / 60,
  maxFrameDt: 0.05,

  player: {
    walkSpeed: 2.4,
    runSpeed: 4.6,
    crouchSpeed: 1.35,
    eyeHeight: 1.65,
    crouchEyeHeight: 1.05,
    mouseSensitivity: 0.0022,
    adsSensitivityMul: 0.55,
    jumpVelocity: 0,
  },

  attention: {
    total: 100,
    transferRate: 55, // % per second when holding transfer
    distractionSpike: 35,
    coughSpike: 28,
    shotSpike: 70,
    fadeMinOpacity: 0.08,
    fadeMaxOpacity: 1.0,
  },

  guard: {
    patrolSpeed: 1.15,
    chaseSpeed: 3.2,
    hearingRadiusQuiet: 4.5,
    hearingRadiusLoud: 28,
    lightThreshold: 0.22,
    suspicionRise: 0.55,
    suspicionDecay: 0.18,
    alarmThreshold: 1.0,
    fovDeg: 110,
    viewDistance: 22,
  },

  weapon: {
    fireRate: 9.5,
    damage: 34,
    magSize: 18,
    reserve: 72,
    recoilKick: 0.028,
    recoilRecovery: 8.5,
    swayAmp: 0.0045,
    swayFreq: 1.7,
    adsFov: 48,
    hipFov: 75,
    reloadTime: 1.65,
    pelletSpreadHip: 0.018,
    pelletSpreadAds: 0.004,
  },

  economy: {
    contractValue: 12000,
    stealthBonus: 4000,
    ammoCost: 18,
    damageCost: 85,
    hazardPayPerSec: 12,
    loudEntryFee: 1500,
  },

  room: {
    width: 28,
    depth: 22,
    height: 3.6,
  },
};

export const KEYS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  walk: 'ShiftLeft',
  crouch: 'ControlLeft',
  reload: 'KeyR',
  distract: 'KeyF',
  melee: 'KeyQ',
  holdAttention: 'Digit1',
  releaseAttention: 'Digit2',
  pause: 'Escape',
};
