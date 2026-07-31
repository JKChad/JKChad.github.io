import { CONFIG } from '../config.js';
import { clamp } from '../utils/math.js';

export class Economy {
  constructor(bus) {
    this.bus = bus;
    this.invoice = {
      contract: CONFIG.economy.contractValue,
      stealthBonus: CONFIG.economy.stealthBonus,
      ammo: 0,
      propertyDamage: 0,
      hazardPay: 0,
      loudEntry: 0,
    };
    this.loudTime = 0;
    this.wentLoud = false;
    this.shotsFired = 0;
    this.lightsBroken = 0;
  }

  onWentLoud() {
    if (this.wentLoud) return;
    this.wentLoud = true;
    this.invoice.stealthBonus = 0;
    this.invoice.loudEntry = CONFIG.economy.loudEntryFee;
    this.bus.emit('economy:updated', this.snapshot());
  }

  onShot() {
    this.shotsFired++;
    this.invoice.ammo += CONFIG.economy.ammoCost;
    this.bus.emit('economy:updated', this.snapshot());
  }

  onPropertyDamage(cost = CONFIG.economy.damageCost) {
    this.invoice.propertyDamage += cost;
    this.lightsBroken++;
    this.bus.emit('economy:updated', this.snapshot());
  }

  update(dt, mode) {
    if (mode !== 'loud') return;
    this.loudTime += dt;
    this.invoice.hazardPay += CONFIG.economy.hazardPayPerSec * dt;
    this.bus.emit('economy:updated', this.snapshot());
  }

  net() {
    const i = this.invoice;
    return Math.floor(
      i.contract + i.stealthBonus - i.ammo - i.propertyDamage - i.hazardPay - i.loudEntry
    );
  }

  snapshot() {
    return {
      ...this.invoice,
      hazardPay: Math.floor(this.invoice.hazardPay),
      net: this.net(),
      wentLoud: this.wentLoud,
      shotsFired: this.shotsFired,
      lightsBroken: this.lightsBroken,
      loudTime: this.loudTime,
    };
  }
}
