import { level01_Archives } from './level01_Archives.js';
import { level02_Substation } from './level02_Substation.js';
import { level03_LoadingBay } from './level03_LoadingBay.js';

export { level01_Archives, level02_Substation, level03_LoadingBay };

export const LEVEL_CATALOG = Object.freeze([
  level01_Archives,
  level02_Substation,
  level03_LoadingBay,
]);

export const LEVELS_BY_ID = Object.freeze(
  Object.fromEntries(LEVEL_CATALOG.map((level) => [level.id, level])),
);

export const DEFAULT_LEVEL_ID = level01_Archives.id;
