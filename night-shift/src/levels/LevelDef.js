export const LEVEL_SCHEMA_VERSION = 1;

export const LIGHT_ROLES = Object.freeze({
  key: 'key',
  fill: 'fill',
  trap: 'trap',
  alarm: 'alarm',
});

export const LIGHT_PALETTE = Object.freeze({
  sodiumAmber: 0xff982b,
  hotSodiumAmber: 0xffb05a,
  coldBlueGray: 0x9fb6c4,
  dimBlueGray: 0x6f8791,
  dirtyGreenBlack: 0x4f7f65,
  deadGreen: 0x26362f,
});

export const MATERIAL_KEYS = Object.freeze({
  floor: 'floor',
  wall: 'wall',
  darkWall: 'darkWall',
  steel: 'steel',
  blackSteel: 'blackSteel',
  crate: 'crate',
  vehicle: 'vehicle',
  glass: 'glass',
  amber: 'amber',
  green: 'green',
});

export function point(x, y, z) {
  return { x, y, z };
}

export function pose(x, y, z, yaw = 0) {
  return { x, y, z, yaw };
}

export function shadowLane(from, to, note = '') {
  return { from, to, note };
}

export function normalizeLevelDef(level) {
  if (!level || typeof level !== 'object') {
    throw new TypeError('LevelDef must be an object.');
  }

  const required = ['id', 'title', 'brief', 'bounds', 'extract', 'spawn', 'lights', 'geometry', 'patrols'];
  for (const key of required) {
    if (level[key] === undefined || level[key] === null) {
      throw new Error(`LevelDef "${level.id ?? 'unknown'}" is missing "${key}".`);
    }
  }

  return Object.freeze({
    schemaVersion: LEVEL_SCHEMA_VERSION,
    objectives: ['extract'],
    shadowLanes: [],
    coverPoints: [],
    shadowPoints: [],
    alarmLayout: null,
    ...level,
  });
}
