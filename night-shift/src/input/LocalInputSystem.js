import { ACTION, InputRouter, createSeatFrame } from '../core/input/InputSeat.js';
import { GamepadDevice } from './GamepadDevice.js';
import { KeyboardDevice } from './KeyboardDevice.js';

const SEAT_COUNT = 2;

const BUTTON_ACTIONS = Object.freeze([
  ACTION.Walk,
  ACTION.Crouch,
  ACTION.Fire,
  ACTION.Ads,
  ACTION.Reload,
  ACTION.Distract,
  ACTION.Melee,
  ACTION.HoldAttention,
  ACTION.ReleaseAttention,
  ACTION.Gadget,
  ACTION.Interact,
  ACTION.WeaponNext,
  ACTION.WeaponPrev,
]);

export class LocalInputSystem {
  constructor({
    target = null,
    pointerElement = target,
    eventTarget = null,
    mouseTarget = null,
    document: ownerDocument = null,
    window: ownerWindow = null,
    navigator: inputNavigator = null,
    pointerLookSeat = 0,
    autoBind = true,
    keyboard = true,
    keyboardSeat1 = true,
    gamepads = true,
  } = {}) {
    this.router = new InputRouter();
    this.target = target;
    this.pointerElement = pointerElement;
    this.eventTarget = eventTarget;
    this.mouseTarget = mouseTarget;
    this.document = ownerDocument;
    this.window = ownerWindow;
    this.navigator = inputNavigator;
    this.pointerLookSeat = pointerLookSeat;
    this.keyboardDevices = [];
    this.gamepadDevices = [];
    this.deviceGroups = Array.from({ length: SEAT_COUNT }, () => new CompositeInputDevice());

    for (let seat = 0; seat < SEAT_COUNT; seat += 1) {
      this.router.seat(seat).setDevice(this.deviceGroups[seat]);
    }

    if (autoBind) {
      this.bindDefaults({ keyboard, keyboardSeat1, gamepads });
    }
  }

  bindDefaults({
    keyboard = true,
    keyboardSeat1 = true,
    gamepads = true,
    keyboardBindings = null,
    keyboardOverrides = null,
    gamepadBindings = null,
    mouseSensitivity = undefined,
    moveDeadzone = undefined,
    lookDeadzone = undefined,
    lookRate = undefined,
  } = {}) {
    this._clearDevices({ dispose: true });
    this.keyboardDevices = [];
    this.gamepadDevices = [];

    for (let seat = 0; seat < SEAT_COUNT; seat += 1) {
      const group = this.deviceGroups[seat];

      if (keyboard && (seat === 0 || keyboardSeat1)) {
        const keyboardDevice = new KeyboardDevice({
          seat,
          bindings: bindingForSeat(keyboardBindings, seat),
          overrides: bindingForSeat(keyboardOverrides, seat),
          eventTarget: this.eventTarget,
          mouseTarget: this.mouseTarget,
          pointerElement: this.pointerElement,
          document: this.document,
          window: this.window,
          pointerLookSeat: this.pointerLookSeat,
          mouseSensitivity,
        });
        this.keyboardDevices[seat] = keyboardDevice;
        group.addDevice(keyboardDevice);
      }

      if (gamepads) {
        const gamepadDevice = new GamepadDevice({
          seat,
          gamepadIndex: seat,
          navigator: this.navigator,
          bindings: bindingForSeat(gamepadBindings, seat) ?? gamepadBindings ?? undefined,
          moveDeadzone,
          lookDeadzone,
          lookRate,
        });
        this.gamepadDevices[seat] = gamepadDevice;
        group.addDevice(gamepadDevice);
      }
    }

    return this;
  }

  getSeat(seatIndex = 0) {
    return this.router.seat(seatIndex);
  }

  getDeviceGroup(seatIndex = 0) {
    return this.deviceGroups[seatIndex] ?? null;
  }

  assignDevice(seatIndex, device, { replace = false, disposeReplaced = false } = {}) {
    const group = this.getDeviceGroup(seatIndex);
    if (!group) return this;
    if (replace) group.clearDevices({ dispose: disposeReplaced });
    group.addDevice(device);
    return this;
  }

  setSeatDevice(seatIndex, device, { disposeReplaced = false } = {}) {
    return this.assignDevice(seatIndex, device, { replace: true, disposeReplaced });
  }

  setPointerLookSeat(seatIndex = 0) {
    this.pointerLookSeat = seatIndex;
    for (const keyboardDevice of this.keyboardDevices) {
      keyboardDevice?.setPointerLookSeat(seatIndex);
    }
    return this;
  }

  poll(dt = 0) {
    return this.router.poll(dt);
  }

  dispose() {
    this._clearDevices({ dispose: true });
    this.keyboardDevices = [];
    this.gamepadDevices = [];
    return this;
  }

  _clearDevices({ dispose = false } = {}) {
    for (const group of this.deviceGroups) {
      group.clearDevices({ dispose });
    }
  }
}

export class CompositeInputDevice {
  constructor(devices = []) {
    this.devices = [];
    this._scratch = createSeatFrame();
    for (const device of devices) this.addDevice(device);
  }

  addDevice(device) {
    if (device && !this.devices.includes(device)) this.devices.push(device);
    return this;
  }

  removeDevice(device, { dispose = false } = {}) {
    const index = this.devices.indexOf(device);
    if (index < 0) return this;
    const [removed] = this.devices.splice(index, 1);
    if (dispose) removed?.dispose?.();
    return this;
  }

  clearDevices({ dispose = false } = {}) {
    if (dispose) {
      for (const device of this.devices) device?.dispose?.();
    }
    this.devices.length = 0;
    return this;
  }

  poll(frame = createSeatFrame(), dt = 0, seat = 0) {
    resetFrame(frame);

    for (const device of this.devices) {
      resetFrame(this._scratch);
      device?.poll?.(this._scratch, dt, seat);
      mergeFrame(frame, this._scratch);
    }

    normalizeMove(frame);
    return frame;
  }

  dispose() {
    return this.clearDevices({ dispose: true });
  }
}

export function mergeFrame(target, source) {
  target.moveX += source.moveX || 0;
  target.moveY += source.moveY || 0;
  target.lookX += source.lookX || 0;
  target.lookY += source.lookY || 0;

  for (const action of BUTTON_ACTIONS) {
    target[action] = Boolean(target[action] || source[action]);
  }

  return target;
}

function normalizeMove(frame) {
  const length = Math.hypot(frame.moveX, frame.moveY);
  if (length > 1) {
    frame.moveX /= length;
    frame.moveY /= length;
  }
  return frame;
}

function resetFrame(frame) {
  const seq = frame.seq ?? 0;
  Object.assign(frame, createSeatFrame(), { seq });
  return frame;
}

function bindingForSeat(bindings, seat) {
  if (!bindings) return null;
  if (Object.prototype.hasOwnProperty.call(bindings, seat)) return bindings[seat];
  if (Object.prototype.hasOwnProperty.call(bindings, String(seat))) return bindings[String(seat)];
  const hasSeatKeys =
    Object.prototype.hasOwnProperty.call(bindings, 0) ||
    Object.prototype.hasOwnProperty.call(bindings, '0') ||
    Object.prototype.hasOwnProperty.call(bindings, 1) ||
    Object.prototype.hasOwnProperty.call(bindings, '1');
  return hasSeatKeys ? null : bindings;
}
