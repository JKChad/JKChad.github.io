import { ACTION, createSeatFrame } from '../core/input/InputSeat.js';
import {
  collectBindingCodes,
  getDefaultKeyBindingsForSeat,
  isAxisBinding,
  mergeKeyBindings,
} from './bindings.js';

const DEFAULT_MOUSE_SENSITIVITY = 0.0022;

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

export class KeyboardDevice {
  constructor({
    seat = 0,
    bindings = null,
    overrides = null,
    eventTarget = null,
    mouseTarget = null,
    pointerElement = null,
    document: ownerDocument = null,
    window: ownerWindow = null,
    pointerLookSeat = 0,
    mouseSensitivity = DEFAULT_MOUSE_SENSITIVITY,
    invertLookX = false,
    invertLookY = false,
    preventDefault = true,
    allowInTextFields = false,
    autoConnect = true,
  } = {}) {
    this.seat = seat;
    this.bindings = mergeKeyBindings(bindings ?? getDefaultKeyBindingsForSeat(seat), overrides ?? {});
    this.boundCodes = collectBindingCodes(this.bindings);

    this.window = ownerWindow ?? globalThis.window ?? null;
    this.document = ownerDocument ?? this.window?.document ?? globalThis.document ?? null;
    this.eventTarget = eventTarget ?? this.window ?? this.document;
    this.mouseTarget = mouseTarget ?? this.document ?? this.eventTarget;
    this.pointerElement = pointerElement;
    this.pointerLookSeat = pointerLookSeat;
    this.mouseSensitivity = mouseSensitivity;
    this.invertLookX = invertLookX;
    this.invertLookY = invertLookY;
    this.preventDefault = preventDefault;
    this.allowInTextFields = allowInTextFields;

    this.enabled = true;
    this.connected = false;
    this._manualPointerLocked = null;
    this._pointerLocked = false;
    this._downCodes = new Set();
    this._pulseCodes = new Set();
    this._lookX = 0;
    this._lookY = 0;
    this._listeners = [];

    this._onKeyDown = (event) => this._handleKeyDown(event);
    this._onKeyUp = (event) => this._handleKeyUp(event);
    this._onMouseDown = (event) => this._handleMouseDown(event);
    this._onMouseUp = (event) => this._handleMouseUp(event);
    this._onMouseMove = (event) => this._handleMouseMove(event);
    this._onWheel = (event) => this._handleWheel(event);
    this._onBlur = () => this.clear();
    this._onPointerLockChange = () => this._syncPointerLock();

    if (autoConnect) this.connect();
  }

  connect() {
    if (this.connected) return this;

    this._listen(this.eventTarget, 'keydown', this._onKeyDown, { passive: false });
    this._listen(this.eventTarget, 'keyup', this._onKeyUp, { passive: false });
    this._listen(this.window, 'blur', this._onBlur);
    this._listen(this.mouseTarget, 'mousedown', this._onMouseDown, { passive: false });
    this._listen(this.mouseTarget, 'mouseup', this._onMouseUp, { passive: false });
    this._listen(this.mouseTarget, 'mousemove', this._onMouseMove);
    this._listen(this.mouseTarget, 'wheel', this._onWheel, { passive: false });
    this._listen(this.document, 'pointerlockchange', this._onPointerLockChange);
    this._syncPointerLock();
    this.connected = true;
    return this;
  }

  disconnect() {
    for (const { target, type, handler, options } of this._listeners) {
      target.removeEventListener(type, handler, options);
    }
    this._listeners.length = 0;
    this.connected = false;
    this.clear();
    return this;
  }

  dispose() {
    return this.disconnect();
  }

  setBindings(bindings, overrides = null) {
    this.bindings = mergeKeyBindings(bindings, overrides ?? {});
    this.boundCodes = collectBindingCodes(this.bindings);
    return this;
  }

  setPointerLookSeat(seatIndex = 0) {
    this.pointerLookSeat = seatIndex;
    return this;
  }

  setPointerElement(pointerElement) {
    this.pointerElement = pointerElement;
    this._syncPointerLock();
    return this;
  }

  setPointerLocked(locked) {
    this._manualPointerLocked = Boolean(locked);
    this._pointerLocked = this._manualPointerLocked;
    return this;
  }

  clearPointerLockedOverride() {
    this._manualPointerLocked = null;
    this._syncPointerLock();
    return this;
  }

  lockPointer() {
    this.pointerElement?.requestPointerLock?.();
  }

  clear() {
    this._downCodes.clear();
    this._pulseCodes.clear();
    this._lookX = 0;
    this._lookY = 0;
    return this;
  }

  hasPointerLookFocus() {
    return this.enabled && this.seat === this.pointerLookSeat && this._pointerLocked;
  }

  poll(frame = createSeatFrame()) {
    resetFrame(frame);

    if (!this.enabled) {
      this._clearTransientInput();
      return frame;
    }

    const moveX = this._axisValue(this.bindings[ACTION.MoveX]);
    const moveY = this._axisValue(this.bindings[ACTION.MoveY]);
    const moveLen = Math.hypot(moveX, moveY);
    frame.moveX = moveLen > 1 ? moveX / moveLen : moveX;
    frame.moveY = moveLen > 1 ? moveY / moveLen : moveY;

    if (this.hasPointerLookFocus()) {
      frame.lookX = this._lookX * this.mouseSensitivity * (this.invertLookX ? -1 : 1);
      frame.lookY = this._lookY * this.mouseSensitivity * (this.invertLookY ? -1 : 1);
    }

    for (const action of BUTTON_ACTIONS) {
      frame[action] = this._buttonValue(this.bindings[action]);
    }

    this._clearTransientInput();
    return frame;
  }

  _listen(target, type, handler, options) {
    if (!target?.addEventListener || !target?.removeEventListener) return;
    target.addEventListener(type, handler, options);
    this._listeners.push({ target, type, handler, options });
  }

  _handleKeyDown(event) {
    if (!this._shouldHandleEvent(event)) return;
    const code = event.code;
    if (!code) return;
    this._downCodes.add(code);
    this._preventIfBound(event, code);
  }

  _handleKeyUp(event) {
    if (!this._shouldHandleEvent(event)) return;
    const code = event.code;
    if (!code) return;
    this._downCodes.delete(code);
    this._preventIfBound(event, code);
  }

  _handleMouseDown(event) {
    const code = mouseCode(event.button);
    this._downCodes.add(code);
    this._preventIfBound(event, code);
  }

  _handleMouseUp(event) {
    const code = mouseCode(event.button);
    this._downCodes.delete(code);
    this._preventIfBound(event, code);
  }

  _handleMouseMove(event) {
    this._syncPointerLock();
    if (!this.hasPointerLookFocus()) return;
    this._lookX += event.movementX ?? 0;
    this._lookY += event.movementY ?? 0;
  }

  _handleWheel(event) {
    const code = (event.deltaY ?? 0) < 0 ? 'WheelUp' : 'WheelDown';
    this._pulseCodes.add(code);
    this._preventIfBound(event, code);
  }

  _syncPointerLock() {
    if (this._manualPointerLocked !== null) {
      this._pointerLocked = this._manualPointerLocked;
      return;
    }
    const lockedElement = this.document?.pointerLockElement ?? null;
    this._pointerLocked = Boolean(
      lockedElement && (!this.pointerElement || lockedElement === this.pointerElement),
    );
  }

  _axisValue(binding) {
    if (!isAxisBinding(binding)) return 0;
    const positive = hasActiveCode(binding.positive, this._downCodes, this._pulseCodes) ? 1 : 0;
    const negative = hasActiveCode(binding.negative, this._downCodes, this._pulseCodes) ? 1 : 0;
    return positive - negative;
  }

  _buttonValue(binding) {
    return hasActiveCode(binding, this._downCodes, this._pulseCodes);
  }

  _shouldHandleEvent(event) {
    return this.enabled && (this.allowInTextFields || !isEditableTarget(event.target));
  }

  _preventIfBound(event, code) {
    if (this.preventDefault && this.boundCodes.has(code)) event.preventDefault?.();
  }

  _clearTransientInput() {
    this._pulseCodes.clear();
    this._lookX = 0;
    this._lookY = 0;
  }
}

export function resetFrame(frame) {
  const seq = frame.seq ?? 0;
  Object.assign(frame, createSeatFrame(), { seq });
  return frame;
}

function hasActiveCode(binding, downCodes, pulseCodes) {
  const codes = isAxisBinding(binding) ? [] : normalizeBinding(binding);
  for (const code of codes) {
    if (downCodes.has(code) || pulseCodes.has(code)) return true;
  }
  return false;
}

function normalizeBinding(binding) {
  if (!binding) return [];
  return Array.isArray(binding) ? binding : [binding];
}

function mouseCode(button = 0) {
  return `Mouse${button}`;
}

function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toLowerCase?.();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}
