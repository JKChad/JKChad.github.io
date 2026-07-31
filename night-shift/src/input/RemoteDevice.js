import { ACTION, createSeatFrame } from '../core/input/InputSeat.js';

export const NET_BUTTON_BITS = Object.freeze({
  [ACTION.Walk]: 1,
  [ACTION.Crouch]: 2,
  [ACTION.Fire]: 4,
  [ACTION.Ads]: 8,
  [ACTION.Reload]: 16,
  [ACTION.Distract]: 32,
  [ACTION.Melee]: 64,
  [ACTION.HoldAttention]: 128,
  [ACTION.ReleaseAttention]: 256,
  [ACTION.Gadget]: 512,
  [ACTION.Interact]: 1024,
  [ACTION.WeaponNext]: 2048,
  [ACTION.WeaponPrev]: 4096,
});

export class RemoteDevice {
  constructor({ seat = 1, packet = null } = {}) {
    this.seat = seat;
    this.packet = packet;
    this.lastRemoteSeq = packet?.seq ?? 0;
    this.enabled = true;
  }

  fromNet(packet) {
    this.packet = packet;
    this.lastRemoteSeq = packet?.seq ?? this.lastRemoteSeq;
    return this;
  }

  applyPacket(packet) {
    return this.fromNet(packet);
  }

  clear() {
    this.packet = null;
    return this;
  }

  poll(frame = createSeatFrame()) {
    resetFrame(frame);
    if (!this.enabled || !this.packet) return frame;

    applyNetPacketToFrame(frame, this.packet, { applySeq: false });
    return frame;
  }
}

export function applyNetPacketToFrame(frame, packet, { applySeq = true } = {}) {
  if (!packet) return frame;

  if (applySeq) frame.seq = packet.seq ?? frame.seq;
  frame.moveX = packet.mx ?? packet.moveX ?? 0;
  frame.moveY = packet.my ?? packet.moveY ?? 0;
  frame.lookX = packet.lx ?? packet.lookX ?? 0;
  frame.lookY = packet.ly ?? packet.lookY ?? 0;

  const buttons = packet.b ?? 0;
  for (const [action, bit] of Object.entries(NET_BUTTON_BITS)) {
    frame[action] = packet[action] ?? Boolean(buttons & bit);
  }

  return frame;
}

function resetFrame(frame) {
  const seq = frame.seq ?? 0;
  Object.assign(frame, createSeatFrame(), { seq });
  return frame;
}
