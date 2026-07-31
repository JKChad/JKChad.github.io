/**
 * Engine-agnostic economy: invoice, four merc stats, drone modules.
 */

export const STAT = {
  SILENCE: 'silence',
  MUSCLE: 'muscle',
  TECH: 'tech',
  NERVE: 'nerve',
};

export const DRONE_MODULES = {
  scout: { id: 'scout', name: 'Scout Optic', tech: 1, silence: 1 },
  emp: { id: 'emp', name: 'EMP Spit', tech: 2 },
  decoy: { id: 'decoy', name: 'Noise Decoy', silence: 1, nerve: 1 },
  medic: { id: 'medic', name: 'Stim Drop', nerve: 2 },
};

export class InvoiceLedger {
  constructor(config = {}) {
    this.config = {
      contractValue: 12000,
      stealthBonus: 4000,
      ammoCost: 18,
      damageCost: 85,
      hazardPayPerSec: 12,
      loudEntryFee: 1500,
      bodyFoundPenalty: 2000,
      civilianPenalty: 5000,
      ...config,
    };
    this.lines = {
      contract: this.config.contractValue,
      stealthBonus: this.config.stealthBonus,
      ammo: 0,
      propertyDamage: 0,
      hazardPay: 0,
      loudEntry: 0,
      bodyFound: 0,
      gadgetUse: 0,
      droneLease: 350,
    };
    this.wentLoud = false;
    this.loudTime = 0;
    this.shotsFired = 0;
    this.lightsBroken = 0;
    this.bodiesFound = 0;
  }

  onWentLoud() {
    if (this.wentLoud) return;
    this.wentLoud = true;
    this.lines.stealthBonus = 0;
    this.lines.loudEntry = this.config.loudEntryFee;
  }

  onShot(cost = this.config.ammoCost) {
    this.shotsFired++;
    this.lines.ammo += cost;
  }

  onPropertyDamage(cost = this.config.damageCost) {
    this.lightsBroken++;
    this.lines.propertyDamage += cost;
  }

  onBodyFound() {
    this.bodiesFound++;
    this.lines.bodyFound += this.config.bodyFoundPenalty;
  }

  onGadget(cost = 120) {
    this.lines.gadgetUse += cost;
  }

  update(dt, mode) {
    if (mode !== 'loud') return;
    this.loudTime += dt;
    this.lines.hazardPay += this.config.hazardPayPerSec * dt;
  }

  net() {
    const l = this.lines;
    return Math.floor(
      l.contract +
        l.stealthBonus -
        l.ammo -
        l.propertyDamage -
        l.hazardPay -
        l.loudEntry -
        l.bodyFound -
        l.gadgetUse -
        l.droneLease,
    );
  }

  itemized() {
    return {
      ...this.lines,
      hazardPay: Math.floor(this.lines.hazardPay),
      net: this.net(),
      wentLoud: this.wentLoud,
      shotsFired: this.shotsFired,
      lightsBroken: this.lightsBroken,
      bodiesFound: this.bodiesFound,
      loudTime: this.loudTime,
    };
  }
}

export class MercStats {
  constructor() {
    this.values = {
      [STAT.SILENCE]: 1,
      [STAT.MUSCLE]: 1,
      [STAT.TECH]: 1,
      [STAT.NERVE]: 1,
    };
  }

  get(stat) {
    return this.values[stat] ?? 1;
  }

  add(stat, amount = 1) {
    this.values[stat] = (this.values[stat] ?? 0) + amount;
  }

  /** Soft multipliers for systems */
  multipliers() {
    return {
      footstepQuiet: 1 + this.get(STAT.SILENCE) * 0.08,
      weaponStability: 1 + this.get(STAT.MUSCLE) * 0.06,
      gadgetCooldown: Math.max(0.55, 1 - this.get(STAT.TECH) * 0.07),
      suppressFear: 1 + this.get(STAT.NERVE) * 0.05,
    };
  }
}

export class DroneLoadout {
  constructor() {
    this.modules = [DRONE_MODULES.scout];
    this.active = 0;
  }

  equip(moduleId) {
    const mod = DRONE_MODULES[moduleId];
    if (!mod) return false;
    if (this.modules.find((m) => m.id === moduleId)) return false;
    if (this.modules.length >= 3) this.modules.pop();
    this.modules.push(mod);
    return true;
  }

  swap(index) {
    if (index < 0 || index >= this.modules.length) return null;
    this.active = index;
    return this.modules[index];
  }

  current() {
    return this.modules[this.active] || null;
  }
}
