import * as THREE from 'three';
import { CONFIG, KEYS } from '../config.js';
import { clamp, damp, saturate } from '../utils/math.js';

const ROOM_X_MIN = -CONFIG.room.width * 0.5 + 0.5;
const ROOM_X_MAX = CONFIG.room.width * 0.5 - 0.5;
const ROOM_Z_MIN = -CONFIG.room.depth * 0.5 + 0.5;
const ROOM_Z_MAX = CONFIG.room.depth * 0.5 - 0.5;
const HALF_PI = Math.PI * 0.5;

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();

export class FPSController {
  constructor(scene, bus, domElement) {
    this.scene = scene;
    this.bus = bus;
    this.domElement = domElement;

    this.camera = new THREE.PerspectiveCamera(
      CONFIG.weapon.hipFov,
      window.innerWidth / window.innerHeight,
      0.05,
      90,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.name = 'PlayerCamera';
    scene.add(this.camera);

    this.position = new THREE.Vector3(0, 0, 7.2);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.isAds = false;
    this.isGrounded = true;
    this.isCrouching = false;
    this.isMoving = false;

    this._keys = new Set();
    this._mouseLocked = false;
    this._eyeHeight = CONFIG.player.eyeHeight;
    this._stepPhase = 0;
    this._nextFootstep = 0;
    this._attentionDir = 0;
    this._recoilPitch = 0;
    this._recoilYaw = 0;

    this._onMouseMove = (event) => this._handleMouseMove(event);
    this._onPointerLockChange = () => this._handlePointerLockChange();
    this._onKeyDown = (event) => this._handleKeyDown(event);
    this._onKeyUp = (event) => this._handleKeyUp(event);
    this._onCanvasMouseDown = () => {
      if (!this._mouseLocked) this.lockPointer();
    };

    const doc = this.domElement.ownerDocument ?? document;
    doc.addEventListener('mousemove', this._onMouseMove);
    doc.addEventListener('pointerlockchange', this._onPointerLockChange);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this.domElement.addEventListener('mousedown', this._onCanvasMouseDown);

    this._syncCamera();
  }

  lockPointer() {
    if (this.domElement.requestPointerLock) {
      this.domElement.requestPointerLock();
    }
  }

  addRecoil(pitchKick = 0.018, yawKick = 0) {
    this._recoilPitch += pitchKick;
    this._recoilYaw += yawKick;
  }

  update(dt, visibility = 1) {
    const safeDt = Math.min(dt, CONFIG.maxFrameDt);
    this.isCrouching = this._keys.has(KEYS.crouch);

    const targetEye = this.isCrouching ? CONFIG.player.crouchEyeHeight : CONFIG.player.eyeHeight;
    this._eyeHeight = damp(this._eyeHeight, targetEye, 16, safeDt);

    this._buildWishDirection(_wish);
    const hasInput = _wish.lengthSq() > 0.0001;
    if (hasInput) _wish.normalize();

    const quietMul = 0.94 + 0.06 * saturate(visibility);
    const speed = this.isCrouching
      ? CONFIG.player.crouchSpeed
      : this._keys.has(KEYS.walk)
        ? CONFIG.player.walkSpeed
        : CONFIG.player.runSpeed;

    const targetVx = hasInput ? _wish.x * speed * quietMul : 0;
    const targetVz = hasInput ? _wish.z * speed * quietMul : 0;
    const accel = hasInput ? (this.isCrouching ? 18 : 24) : 20;
    this.velocity.x = damp(this.velocity.x, targetVx, accel, safeDt);
    this.velocity.y = 0;
    this.velocity.z = damp(this.velocity.z, targetVz, accel, safeDt);

    this.position.x += this.velocity.x * safeDt;
    this.position.z += this.velocity.z * safeDt;
    this.position.x = clamp(this.position.x, ROOM_X_MIN, ROOM_X_MAX);
    this.position.y = 0;
    this.position.z = clamp(this.position.z, ROOM_Z_MIN, ROOM_Z_MAX);

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.isMoving = horizontalSpeed > 0.08;
    this._updateFootsteps(safeDt, horizontalSpeed, visibility);
    this._updateRecoil(safeDt);
    this._syncCamera();
  }

  _buildWishDirection(out) {
    out.set(0, 0, 0);
    _forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this._keys.has(KEYS.forward)) out.add(_forward);
    if (this._keys.has(KEYS.back)) out.sub(_forward);
    if (this._keys.has(KEYS.right)) out.add(_right);
    if (this._keys.has(KEYS.left)) out.sub(_right);
    return out;
  }

  _handleMouseMove(event) {
    if (!this._mouseLocked) return;

    const sens = CONFIG.player.mouseSensitivity * (this.isAds ? CONFIG.player.adsSensitivityMul : 1);
    this.yaw -= event.movementX * sens;
    this.pitch -= event.movementY * sens;
    this.pitch = clamp(this.pitch, -HALF_PI + 0.02, HALF_PI - 0.02);
  }

  _handlePointerLockChange() {
    const doc = this.domElement.ownerDocument ?? document;
    this._mouseLocked = doc.pointerLockElement === this.domElement;
  }

  _handleKeyDown(event) {
    if (event.repeat) return;
    this._keys.add(event.code);

    if (event.code === KEYS.holdAttention || event.code === KEYS.releaseAttention) {
      this._emitAttentionDir(this._currentAttentionDir());
    } else if (event.code === KEYS.distract) {
      this.bus.emit('player:distract', { kind: 'cough' });
    }
  }

  _handleKeyUp(event) {
    this._keys.delete(event.code);

    if (event.code === KEYS.holdAttention || event.code === KEYS.releaseAttention) {
      this._emitAttentionDir(this._currentAttentionDir());
    }
  }

  _currentAttentionDir() {
    if (this._keys.has(KEYS.holdAttention)) return 1;
    if (this._keys.has(KEYS.releaseAttention)) return -1;
    return 0;
  }

  _emitAttentionDir(dir) {
    if (dir === this._attentionDir) return;
    this._attentionDir = dir;
    this.bus.emit('attention:transfer', { dir });
  }

  _updateFootsteps(dt, horizontalSpeed, visibility) {
    if (!this.isMoving || this.isCrouching) {
      this._nextFootstep = 0;
      return;
    }

    const cadence = this._keys.has(KEYS.walk) ? 2.15 : 3.25;
    this._stepPhase += horizontalSpeed * cadence * dt;
    if (this._stepPhase >= this._nextFootstep) {
      this._nextFootstep = this._stepPhase + Math.PI;
      this.bus.emit('player:footstep', {
        position: this.position,
        loudness: (this._keys.has(KEYS.walk) ? 0.35 : 0.75) * (0.45 + 0.55 * saturate(visibility)),
      });
    }
  }

  _updateRecoil(dt) {
    this._recoilPitch = damp(this._recoilPitch, 0, CONFIG.weapon.recoilRecovery, dt);
    this._recoilYaw = damp(this._recoilYaw, 0, CONFIG.weapon.recoilRecovery, dt);
  }

  _syncCamera() {
    this.camera.position.set(this.position.x, this.position.y + this._eyeHeight, this.position.z);
    this.camera.rotation.set(
      this.pitch + this._recoilPitch,
      this.yaw + this._recoilYaw,
      0,
      'YXZ',
    );
  }
}
