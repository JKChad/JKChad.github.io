/**
 * Genre hard-cut: stealth never soft-fails into a restart.
 * Spotted → alarm → frantic CQB mode.
 */
export class ModeManager {
  constructor(bus) {
    this.bus = bus;
    /** @type {'stealth' | 'loud'} */
    this.mode = 'stealth';
    this.alarmLatched = false;
  }

  get isStealth() {
    return this.mode === 'stealth';
  }

  get isLoud() {
    return this.mode === 'loud';
  }

  tripAlarm(reason = 'spotted') {
    if (this.alarmLatched) return;
    this.alarmLatched = true;
    this.mode = 'loud';
    this.bus.emit('mode:loud', { reason });
    this.bus.emit('alarm', { reason });
  }

  reset() {
    this.mode = 'stealth';
    this.alarmLatched = false;
  }
}
