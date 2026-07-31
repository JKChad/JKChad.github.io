import { ACTION } from '../core/input/InputSeat.js';

export const INPUT_CODE = Object.freeze({
  MouseLeft: 'Mouse0',
  MouseMiddle: 'Mouse1',
  MouseRight: 'Mouse2',
  WheelUp: 'WheelUp',
  WheelDown: 'WheelDown',
});

export const AXIS_DIRECTIONS = Object.freeze({
  Positive: 'positive',
  Negative: 'negative',
});

const seat0 = {
  [ACTION.MoveX]: {
    negative: ['KeyA'],
    positive: ['KeyD'],
  },
  [ACTION.MoveY]: {
    negative: ['KeyS'],
    positive: ['KeyW'],
  },
  [ACTION.Walk]: ['ShiftLeft'],
  [ACTION.Crouch]: ['ControlLeft'],
  [ACTION.Fire]: [INPUT_CODE.MouseLeft],
  [ACTION.Ads]: [INPUT_CODE.MouseRight],
  [ACTION.Reload]: ['KeyR'],
  [ACTION.Distract]: ['KeyF'],
  [ACTION.Melee]: ['KeyQ'],
  [ACTION.HoldAttention]: ['Digit1'],
  [ACTION.ReleaseAttention]: ['Digit2'],
  [ACTION.Gadget]: ['KeyG'],
  [ACTION.Interact]: ['KeyE'],
  [ACTION.WeaponNext]: [INPUT_CODE.WheelDown],
  [ACTION.WeaponPrev]: [INPUT_CODE.WheelUp],
};

const seat1 = {
  [ACTION.MoveX]: {
    negative: ['ArrowLeft'],
    positive: ['ArrowRight'],
  },
  [ACTION.MoveY]: {
    negative: ['ArrowDown'],
    positive: ['ArrowUp'],
  },
  [ACTION.Walk]: ['Numpad0'],
  [ACTION.Crouch]: ['Numpad1'],
  [ACTION.Fire]: ['NumpadDecimal'],
  [ACTION.Ads]: ['NumpadEnter'],
  [ACTION.Reload]: ['Numpad5'],
  [ACTION.Distract]: ['Numpad4'],
  [ACTION.Melee]: ['Numpad7'],
  [ACTION.HoldAttention]: ['Numpad8'],
  [ACTION.ReleaseAttention]: ['Numpad2'],
  [ACTION.Gadget]: ['Numpad9'],
  [ACTION.Interact]: ['Numpad6'],
  [ACTION.WeaponNext]: ['NumpadAdd'],
  [ACTION.WeaponPrev]: ['NumpadSubtract'],
};

export const DEFAULT_KEY_BINDINGS = deepFreeze({
  0: seat0,
  1: seat1,
});

export function getDefaultKeyBindingsForSeat(seatIndex = 0) {
  return cloneKeyBindings(DEFAULT_KEY_BINDINGS[seatIndex] ?? DEFAULT_KEY_BINDINGS[0]);
}

export function cloneKeyBindings(bindings = {}) {
  if (!bindings) return {};
  const clone = {};
  for (const [action, binding] of Object.entries(bindings)) {
    if (isAxisBinding(binding)) {
      clone[action] = {
        negative: [...(binding.negative ?? [])],
        positive: [...(binding.positive ?? [])],
      };
    } else {
      clone[action] = [...asCodeList(binding)];
    }
  }
  return clone;
}

export function mergeKeyBindings(base = {}, overrides = {}) {
  const merged = cloneKeyBindings(base ?? {});
  for (const [action, binding] of Object.entries(overrides ?? {})) {
    if (isAxisBinding(binding)) {
      const current = isAxisBinding(merged[action])
        ? merged[action]
        : { negative: [], positive: [] };
      merged[action] = {
        negative: binding.negative ? [...binding.negative] : [...(current.negative ?? [])],
        positive: binding.positive ? [...binding.positive] : [...(current.positive ?? [])],
      };
    } else {
      merged[action] = [...asCodeList(binding)];
    }
  }
  return merged;
}

export function setKeyBinding(bindings, action, codes, direction = null) {
  if (!bindings || !action) return bindings;
  const nextCodes = asCodeList(codes);
  if (direction === AXIS_DIRECTIONS.Negative || direction === AXIS_DIRECTIONS.Positive) {
    const current = isAxisBinding(bindings[action])
      ? bindings[action]
      : { negative: [], positive: [] };
    bindings[action] = {
      negative: [...(current.negative ?? [])],
      positive: [...(current.positive ?? [])],
      [direction]: nextCodes,
    };
  } else {
    bindings[action] = nextCodes;
  }
  return bindings;
}

export function collectBindingCodes(bindings = {}) {
  const codes = new Set();
  for (const binding of Object.values(bindings)) {
    if (isAxisBinding(binding)) {
      for (const code of binding.negative ?? []) codes.add(code);
      for (const code of binding.positive ?? []) codes.add(code);
    } else {
      for (const code of asCodeList(binding)) codes.add(code);
    }
  }
  return codes;
}

export function isAxisBinding(binding) {
  return Boolean(
    binding &&
      typeof binding === 'object' &&
      !Array.isArray(binding) &&
      ('negative' in binding || 'positive' in binding),
  );
}

export function asCodeList(codes) {
  if (!codes) return [];
  return Array.isArray(codes) ? codes.filter(Boolean) : [codes].filter(Boolean);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
