export const ENEMY_TYPE_IDS = Object.freeze({
  rusher: 'rusher',
  shield: 'shield',
  tech: 'tech',
  sniper: 'sniper',
});

export const ENEMY_TYPES = Object.freeze({
  [ENEMY_TYPE_IDS.rusher]: Object.freeze({
    id: ENEMY_TYPE_IDS.rusher,
    label: 'Rusher',
    health: 66,
    speedMul: 1.36,
    desiredRange: 2.0,
    stopRange: 1.15,
    damage: 5,
    burst: [2, 3],
    cooldown: [0.72, 1.05],
    accuracyBonus: -0.1,
    color: 0x51313a,
    accent: 0xff734f,
    radius: 0.2,
  }),

  [ENEMY_TYPE_IDS.shield]: Object.freeze({
    id: ENEMY_TYPE_IDS.shield,
    label: 'Shield',
    health: 138,
    speedMul: 0.72,
    desiredRange: 5.5,
    stopRange: 3.6,
    damage: 6,
    burst: [1, 2],
    cooldown: [1.0, 1.45],
    accuracyBonus: -0.04,
    frontalBlockCos: 0.34,
    flashVulnerableSeconds: 4.2,
    color: 0x2d3545,
    accent: 0xd4a448,
    radius: 0.27,
  }),

  [ENEMY_TYPE_IDS.tech]: Object.freeze({
    id: ENEMY_TYPE_IDS.tech,
    label: 'Tech',
    health: 88,
    speedMul: 0.92,
    desiredRange: 8.5,
    stopRange: 5.2,
    damage: 5,
    burst: [2, 2],
    cooldown: [0.8, 1.2],
    accuracyBonus: 0.02,
    repairRadius: 3.4,
    repairSeconds: 3.2,
    callCheckMul: 0.55,
    empFragile: true,
    color: 0x243d40,
    accent: 0x58f0d1,
    radius: 0.22,
  }),

  [ENEMY_TYPE_IDS.sniper]: Object.freeze({
    id: ENEMY_TYPE_IDS.sniper,
    label: 'Sniper',
    health: 82,
    speedMul: 0.58,
    desiredRange: 15.5,
    stopRange: 11.5,
    damage: 14,
    burst: [1, 1],
    cooldown: [1.45, 2.05],
    accuracyBonus: 0.28,
    prefersDarkCorner: true,
    flashlightOff: true,
    color: 0x202735,
    accent: 0x7f9cff,
    radius: 0.21,
  }),
});

const WAVE_TABLE = Object.freeze({
  1: Object.freeze([
    [ENEMY_TYPE_IDS.rusher, 4],
    [ENEMY_TYPE_IDS.shield, 2],
    [ENEMY_TYPE_IDS.tech, 1],
  ]),
  2: Object.freeze([
    [ENEMY_TYPE_IDS.rusher, 3],
    [ENEMY_TYPE_IDS.shield, 2],
    [ENEMY_TYPE_IDS.tech, 2],
    [ENEMY_TYPE_IDS.sniper, 2],
  ]),
});

export function getEnemyType(id) {
  return ENEMY_TYPES[id] ?? ENEMY_TYPES[ENEMY_TYPE_IDS.rusher];
}

export function pickEnemyType(wave = 1, random = Math.random) {
  const table = WAVE_TABLE[wave] ?? WAVE_TABLE[2];
  const total = table.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [id, weight] of table) {
    roll -= weight;
    if (roll <= 0) return getEnemyType(id);
  }
  return getEnemyType(table[table.length - 1][0]);
}

export function enemyTypeList() {
  return Object.values(ENEMY_TYPES);
}
