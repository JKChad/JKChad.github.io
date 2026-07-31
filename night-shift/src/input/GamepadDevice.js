import { ACTION, createSeatFrame } from '../core/input/InputSeat.js';

export const STANDARD_GAMEPAD_BUTTON = Object.freeze({
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LeftBumper: 4,
  RightBumper: 5,
  LeftTrigger: 6,
  RightTrigger: 7,
  Back: 8,
  Start: 9,
  LeftStick: 10,
  RightStick: 11,
  DpadUp: 12,
  DpadDown: 13,
  DpadLeft: 14,
  DpadRight: 15,
});

export const STANDARD_GAMEPAD_AXIS = Object.freeze({
  LeftX: 0,
  LeftY: 1,
  RightX: 2,
  RightY: 3,
});

export const DEFAULT_GAMEPAD_BINDINGS = deepFreeze({
  [ACTION.Fire]: [{ button: STANDARD_GAMEPAD_BUTTON.RightTrigger, threshold: 0.35 }],
  [ACTION.Ads]: [{ button: STANDARD_GAMEPAD_BUTTON.LeftTrigger, threshold: 0.35 }],
  [ACTION.Reload]: [STANDARD_GAMEPAD_BUTTON.X],
  [ACTION.Interact]: [STANDARD_GAMEPAD_BUTTON.A],
  [ACTION.Crouch]: [STANDARD_GAMEPAD_BUTTON.B],
  [ACTION.Distract]: [STANDARD_GAMEPAD_BUTTON.Y],
  [ACTION.Walk]: [STANDARD_GAMEPAD_BUTTON.LeftBumper],
  [ACTION.Melee]: [STANDARD_GAMEPAD_BUTTON.RightBumper],
  [ACTION.Gadget]: [STANDARD_GAMEPAD_BUTTON.RightStick],
  [ACTION.HoldAttention]: [STANDARD_GAMEPAD_BUTTON.DpadUp],
  [ACTION.ReleaseAttention]: [STANDARD_GAMEPAD_BUTTON.DpadDown],
  [ACTION.WeaponPrev]: [STANDARD_GAMEPAD_BUTTON.DpadLeft],
  [ACTION.WeaponNext]: [STANDARD_GAMEPAD_BUTTON.DpadRight],
});

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

export class GamepadDevice {
  constructor({
    seat = 0,
    gamepadIndex = seat,
    navigator: inputNavigator = null,
    bindings = DEFAULT_GAMEPAD_BINDINGS,
    moveDeadzone = 0.18,
    lookDeadzone = 0.2,
    lookRate = 3.2,
    invertLookY = false,
  } = {}) {
    this.seat = seat;
    this.gamepadIndex = gamepadIndex;
    this.navigator = inputNavigator ?? globalThis.navigator ?? null;
    this.bindings = cloneGamepadBindings(bindings);
    this.moveDeadzone = moveDeadzone;
    this.lookDeadzone = lookDeadzone;
    this.lookRate = lookRate;
    this.invertLookY = invertLookY;
    this.enabled = true;
  }

  setGamepadIndex(gamepadIndex) {
    this.gamepadIndex = gamepadIndex;
    return this;
  }

  setBindings(bindings) {
    this.bindings = cloneGamepadBindings(bindings);
    return this;
  }

  getGamepad() {
    const pads = this.navigator?.getGamepads?.();
    return pads?.[this.gamepadIndex] ?? null;
  }

  isConnected() {
    return Boolean(this.getGamepad()?.connected);
  }

  poll(frame = createSeatFrame(), dt = 0) {
    resetFrame(frame);
    if (!this.enabled) return frame;

    const gamepad = this.getGamepad();
    if (!gamepad?.connected) return frame;

    const move = applyRadialDeadzone(
      readAxis(gamepad, STANDARD_GAMEPAD_AXIS.LeftX),
      readAxis(gamepad, STANDARD_GAMEPAD_AXIS.LeftY),
      this.moveDeadzone,
    );
    frame.moveX = move.x;
    frame.moveY = -move.y;

    const look = applyRadialDeadzone(
      readAxis(gamepad, STANDARD_GAMEPAD_AXIS.RightX),
      readAxis(gamepad, STANDARD_GAMEPAD_AXIS.RightY),
      this.lookDeadzone,
    );
    const safeDt = Math.max(0, dt || 0);
    frame.lookX = look.x * this.lookRate * safeDt;
    frame.lookY = look.y * this.lookRate * safeDt * (this.invertLookY ? -1 : 1);

    for (const action of BUTTON_ACTIONS) {
      frame[action] = buttonBindingActive(gamepad, this.bindings[action]);
    }

    return frame;
  }
}

export function cloneGamepadBindings(bindings = {}) {
  if (!bindings) return {};
  const clone = {};
  for (const [action, binding] of Object.entries(bindings)) {
    clone[action] = normalizeButtonBinding(binding).map((entry) => (
      typeof entry === 'number' ? entry : { ...entry }
    ));
  }
  return clone;
}

export function applyRadialDeadzone(x = 0, y = 0, deadzone = 0.18) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadzone) return { x: 0, y: 0 };
  const scaled = clamp((magnitude - deadzone) / (1 - deadzone), 0, 1);
  return {
    x: (x / magnitude) * scaled,
    y: (y / magnitude) * scaled,
  };
}

export function applyAxialDeadzone(value = 0, deadzone = 0.18) {
  const abs = Math.abs(value);
  if (abs <= deadzone) return 0;
  return Math.sign(value) * clamp((abs - deadzone) / (1 - deadzone), 0, 1);
}

function buttonBindingActive(gamepad, binding) {
  for (const entry of normalizeButtonBinding(binding)) {
    if (buttonActive(gamepad, entry)) return true;
  }
  return false;
}

function buttonActive(gamepad, binding) {
  const buttonIndex = typeof binding === 'number' ? binding : binding?.button;
  if (buttonIndex === undefined) return false;
  const button = gamepad.buttons?.[buttonIndex];
  if (!button) return false;
  const threshold = typeof binding === 'number' ? 0.5 : (binding.threshold ?? 0.5);
  return Boolean(button.pressed) || (button.value ?? 0) >= threshold;
}

function normalizeButtonBinding(binding) {
  if (!binding) return [];
  return Array.isArray(binding) ? binding : [binding];
}

function readAxis(gamepad, axisIndex) {
  return clamp(gamepad.axes?.[axisIndex] ?? 0, -1, 1);
}

function resetFrame(frame) {
  const seq = frame.seq ?? 0;
  Object.assign(frame, createSeatFrame(), { seq });
  return frame;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
