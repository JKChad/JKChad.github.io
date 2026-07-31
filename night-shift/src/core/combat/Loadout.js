export const WEAPON_IDS = Object.freeze({
  smg: 'smg',
  pistol: 'pistol',
  shotgun: 'shotgun',
  dmr: 'dmr',
});

export const GADGET_IDS = Object.freeze({
  flashbang: 'flashbang',
  emp: 'emp',
  taser: 'taser',
});

export const WEAPON_ORDER = Object.freeze([
  WEAPON_IDS.smg,
  WEAPON_IDS.pistol,
  WEAPON_IDS.shotgun,
  WEAPON_IDS.dmr,
]);

export const GADGET_ORDER = Object.freeze([
  GADGET_IDS.flashbang,
  GADGET_IDS.emp,
  GADGET_IDS.taser,
]);

export const WEAPONS = Object.freeze({
  [WEAPON_IDS.smg]: Object.freeze({
    id: WEAPON_IDS.smg,
    name: 'SMG',
    role: 'current loud baseline',
    fireMode: 'auto',
    fireRate: 9.5,
    damage: 34,
    magSize: 18,
    reserve: 72,
    reloadTime: 1.65,
    recoilKick: 0.028,
    spreadHip: 0.018,
    spreadAds: 0.004,
    adsFov: 48,
    hipFov: 75,
    maxDistance: 52,
    pellets: 1,
    shotAttention: 70,
  }),

  [WEAPON_IDS.pistol]: Object.freeze({
    id: WEAPON_IDS.pistol,
    name: 'Pistol',
    role: 'quiet-ish precision fallback',
    fireMode: 'semi',
    fireRate: 4.2,
    damage: 42,
    magSize: 12,
    reserve: 48,
    reloadTime: 1.28,
    recoilKick: 0.021,
    spreadHip: 0.012,
    spreadAds: 0.003,
    adsFov: 50,
    hipFov: 75,
    maxDistance: 44,
    pellets: 1,
    shotAttention: 36,
  }),

  [WEAPON_IDS.shotgun]: Object.freeze({
    id: WEAPON_IDS.shotgun,
    name: 'Shotgun',
    role: 'close range shield answer',
    fireMode: 'pump',
    fireRate: 1.25,
    damage: 19,
    magSize: 6,
    reserve: 24,
    reloadTime: 1.95,
    recoilKick: 0.062,
    spreadHip: 0.07,
    spreadAds: 0.042,
    adsFov: 52,
    hipFov: 75,
    maxDistance: 20,
    pellets: 7,
    shotAttention: 82,
  }),

  [WEAPON_IDS.dmr]: Object.freeze({
    id: WEAPON_IDS.dmr,
    name: 'DMR',
    role: 'ADS strong long sightline tool',
    fireMode: 'semi',
    fireRate: 2.35,
    damage: 66,
    adsDamage: 82,
    magSize: 10,
    reserve: 40,
    reloadTime: 1.82,
    recoilKick: 0.044,
    spreadHip: 0.026,
    spreadAds: 0.0012,
    adsFov: 42,
    hipFov: 75,
    maxDistance: 82,
    pellets: 1,
    shotAttention: 76,
  }),
});

export const GADGETS = Object.freeze({
  [GADGET_IDS.flashbang]: Object.freeze({
    id: GADGET_IDS.flashbang,
    name: 'Flashbang',
    charges: 2,
    range: 9.5,
    coneDeg: 72,
    stunSeconds: 3.4,
    attentionSpike: 38,
    localPressureSeconds: 1.1,
  }),

  [GADGET_IDS.emp]: Object.freeze({
    id: GADGET_IDS.emp,
    name: 'EMP',
    charges: 2,
    radius: 5.2,
    techDamage: 80,
    stunSeconds: 2.2,
    attentionSpike: 24,
  }),

  [GADGET_IDS.taser]: Object.freeze({
    id: GADGET_IDS.taser,
    name: 'Taser',
    charges: 3,
    range: 4.2,
    coneDeg: 16,
    incapacitateSeconds: 14,
    attentionSpike: 18,
  }),
});

export function getWeaponDef(id) {
  return WEAPONS[id] ?? WEAPONS[WEAPON_IDS.smg];
}

export function getGadgetDef(id) {
  return GADGETS[id] ?? GADGETS[GADGET_IDS.flashbang];
}
