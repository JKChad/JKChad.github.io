import { GADGET_ORDER, GADGETS, WEAPON_ORDER, WEAPONS, getGadgetDef, getWeaponDef } from '../core/combat/Loadout.js';

export const WEAPON_PRESENTATION = Object.freeze({
  smg: Object.freeze({
    shortName: 'SMG',
    hudName: 'SMG',
    reticle: 'burst',
    hint: 'Automatic loud baseline',
  }),
  pistol: Object.freeze({
    shortName: 'PSTL',
    hudName: 'PISTOL',
    reticle: 'dot',
    hint: 'Quiet-ish sidearm',
  }),
  shotgun: Object.freeze({
    shortName: 'SG',
    hudName: 'SHOTGUN',
    reticle: 'wide',
    hint: 'Close breach tool',
  }),
  dmr: Object.freeze({
    shortName: 'DMR',
    hudName: 'DMR',
    reticle: 'precision',
    hint: 'ADS lane holder',
  }),
});

export const GADGET_PRESENTATION = Object.freeze({
  flashbang: Object.freeze({
    shortName: 'FLASH',
    hudName: 'FLASHBANG',
    hint: 'Stun cone, local heat spike',
  }),
  emp: Object.freeze({
    shortName: 'EMP',
    hudName: 'EMP',
    hint: 'Breaks lights in radius',
  }),
  taser: Object.freeze({
    shortName: 'TASER',
    hudName: 'TASER',
    hint: 'Short quiet incapacitation',
  }),
});

export function weaponCatalogEntry(id) {
  const def = getWeaponDef(id);
  return {
    ...def,
    ...(WEAPON_PRESENTATION[def.id] ?? {}),
  };
}

export function gadgetCatalogEntry(id) {
  const def = getGadgetDef(id);
  return {
    ...def,
    ...(GADGET_PRESENTATION[def.id] ?? {}),
  };
}

export function listWeapons() {
  return WEAPON_ORDER.map(weaponCatalogEntry);
}

export function listGadgets() {
  return GADGET_ORDER.map(gadgetCatalogEntry);
}

export function initialAmmoState() {
  return Object.fromEntries(
    WEAPON_ORDER.map((id) => {
      const weapon = WEAPONS[id];
      return [id, { mag: weapon.magSize, reserve: weapon.reserve }];
    })
  );
}

export function initialGadgetCharges() {
  return Object.fromEntries(
    Object.values(GADGETS).map((gadget) => [gadget.id, gadget.charges])
  );
}
