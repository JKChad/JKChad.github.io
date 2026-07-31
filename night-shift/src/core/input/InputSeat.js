/**
 * Dual-seat input abstraction.
 * Seat 0 / Seat 1 can be keyboard, gamepad, or remote net frames.
 * Split-screen is NOT required — the seat model is the future-proofing.
 */

export const ACTION = {
  MoveX: 'moveX',
  MoveY: 'moveY',
  LookX: 'lookX',
  LookY: 'lookY',
  Walk: 'walk',
  Crouch: 'crouch',
  Fire: 'fire',
  Ads: 'ads',
  Reload: 'reload',
  Distract: 'distract',
  Melee: 'melee',
  HoldAttention: 'holdAttention',
  ReleaseAttention: 'releaseAttention',
  Gadget: 'gadget',
  Interact: 'interact',
  WeaponNext: 'weaponNext',
  WeaponPrev: 'weaponPrev',
};

export function createSeatFrame() {
  return {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    walk: false,
    crouch: false,
    fire: false,
    ads: false,
    reload: false,
    distract: false,
    melee: false,
    holdAttention: false,
    releaseAttention: false,
    gadget: false,
    interact: false,
    weaponNext: false,
    weaponPrev: false,
    seq: 0,
  };
}

export class InputSeat {
  constructor(seatIndex = 0) {
    this.seat = seatIndex;
    this.frame = createSeatFrame();
    this._prev = createSeatFrame();
    this.device = null; // KeyboardDevice | GamepadDevice | RemoteDevice
  }

  setDevice(device) {
    this.device = device;
  }

  /** Poll device into frame; edge-detect buttons via _prev. */
  poll(dt) {
    Object.assign(this._prev, this.frame);
    if (this.device) this.device.poll(this.frame, dt, this.seat);
    this.frame.seq++;
    return this.frame;
  }

  pressed(action) {
    return Boolean(this.frame[action]) && !this._prev[action];
  }

  released(action) {
    return !this.frame[action] && Boolean(this._prev[action]);
  }

  /** Compact net payload */
  toNet() {
    const f = this.frame;
    return {
      s: this.seat,
      seq: f.seq,
      mx: +f.moveX.toFixed(3),
      my: +f.moveY.toFixed(3),
      lx: +f.lookX.toFixed(3),
      ly: +f.lookY.toFixed(3),
      b:
        (f.walk ? 1 : 0) |
        (f.crouch ? 2 : 0) |
        (f.fire ? 4 : 0) |
        (f.ads ? 8 : 0) |
        (f.reload ? 16 : 0) |
        (f.distract ? 32 : 0) |
        (f.melee ? 64 : 0) |
        (f.holdAttention ? 128 : 0) |
        (f.releaseAttention ? 256 : 0) |
        (f.gadget ? 512 : 0) |
        (f.interact ? 1024 : 0),
    };
  }

  fromNet(packet) {
    if (!packet) return this.frame;
    const f = this.frame;
    f.seq = packet.seq ?? f.seq;
    f.moveX = packet.mx ?? 0;
    f.moveY = packet.my ?? 0;
    f.lookX = packet.lx ?? 0;
    f.lookY = packet.ly ?? 0;
    const b = packet.b ?? 0;
    f.walk = !!(b & 1);
    f.crouch = !!(b & 2);
    f.fire = !!(b & 4);
    f.ads = !!(b & 8);
    f.reload = !!(b & 16);
    f.distract = !!(b & 32);
    f.melee = !!(b & 64);
    f.holdAttention = !!(b & 128);
    f.releaseAttention = !!(b & 256);
    f.gadget = !!(b & 512);
    f.interact = !!(b & 1024);
    return f;
  }
}

export class InputRouter {
  constructor() {
    this.seats = [new InputSeat(0), new InputSeat(1)];
  }

  seat(i) {
    return this.seats[i];
  }

  poll(dt) {
    return this.seats.map((s) => s.poll(dt));
  }
}
