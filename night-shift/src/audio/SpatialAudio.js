import * as THREE from 'three';

const _listenerPos = new THREE.Vector3();
const _sourcePos = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function toVector3(value, out) {
  if (value?.isVector3) return out.copy(value);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return out.set(value.x, value.y, value.z);
  }
  return out.set(0, 0, 0);
}

function setParam(param, value, time) {
  if (!param) return;
  if (typeof param.setTargetAtTime === 'function') {
    param.setTargetAtTime(value, time, 0.025);
  } else {
    param.value = value;
  }
}

function setPannerPosition(panner, position, time) {
  if (panner.positionX) {
    setParam(panner.positionX, position.x, time);
    setParam(panner.positionY, position.y, time);
    setParam(panner.positionZ, position.z, time);
  } else {
    panner.setPosition(position.x, position.y, position.z);
  }
}

function setListenerVector(listener, prefix, vector, time) {
  const x = listener[`${prefix}X`];
  const y = listener[`${prefix}Y`];
  const z = listener[`${prefix}Z`];
  if (x && y && z) {
    setParam(x, vector.x, time);
    setParam(y, vector.y, time);
    setParam(z, vector.z, time);
    return;
  }

  if (prefix === 'position' && listener.setPosition) {
    listener.setPosition(vector.x, vector.y, vector.z);
  }
}

function setListenerOrientation(listener, forward, up, time) {
  if (listener.forwardX) {
    setParam(listener.forwardX, forward.x, time);
    setParam(listener.forwardY, forward.y, time);
    setParam(listener.forwardZ, forward.z, time);
    setParam(listener.upX, up.x, time);
    setParam(listener.upY, up.y, time);
    setParam(listener.upZ, up.z, time);
  } else if (listener.setOrientation) {
    listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}

export class SpatialAudio {
  constructor(audio, options = {}) {
    this.audio = audio;
    this.listenerProvider = options.listenerProvider ?? null;
    this.sampleOcclusion = options.sampleOcclusion ?? (() => 0);
    this.emitters = new Set();
  }

  setListenerProvider(fn) {
    this.listenerProvider = typeof fn === 'function' ? fn : null;
  }

  setOcclusionSampler(fn) {
    this.sampleOcclusion = typeof fn === 'function' ? fn : (() => 0);
  }

  updateListener(listenerLike = null) {
    const ctx = this.audio?.ctx;
    if (!ctx) return;

    const target = listenerLike ?? this.listenerProvider?.();
    if (!target) return;

    const listener = ctx.listener;
    const time = ctx.currentTime;
    if (target.camera) {
      target.camera.getWorldPosition(_listenerPos);
      target.camera.getWorldDirection(_forward);
    } else {
      toVector3(target.position ?? target, _listenerPos);
      if (target.getWorldDirection) {
        target.getWorldDirection(_forward);
      } else if (target.forward?.isVector3) {
        _forward.copy(target.forward);
      } else {
        _forward.set(0, 0, -1);
      }
    }

    if (_forward.lengthSq() < 0.0001) _forward.set(0, 0, -1);
    _forward.normalize();
    setListenerVector(listener, 'position', _listenerPos, time);
    setListenerOrientation(listener, _forward, target.up?.isVector3 ? target.up : _up, time);
  }

  update() {
    this.updateListener();
    for (const emitter of this.emitters) emitter.updateOcclusion();
  }

  createEmitter(position, options = {}) {
    const ctx = this.audio?.ctx;
    if (!ctx) return null;

    const input = ctx.createGain();
    const panner = ctx.createPanner();
    const occlusionFilter = ctx.createBiquadFilter();
    const occlusionGain = ctx.createGain();
    const destination = options.destination ?? this.audio.bus?.(options.bus ?? 'sfx') ?? this.audio.master;

    panner.panningModel = options.panningModel ?? 'HRTF';
    panner.distanceModel = options.distanceModel ?? 'inverse';
    panner.refDistance = options.refDistance ?? 1.25;
    panner.maxDistance = options.maxDistance ?? 34;
    panner.rolloffFactor = options.rolloffFactor ?? 1.45;
    panner.coneInnerAngle = options.coneInnerAngle ?? 360;
    panner.coneOuterAngle = options.coneOuterAngle ?? 360;
    panner.coneOuterGain = options.coneOuterGain ?? 0;

    occlusionFilter.type = 'lowpass';
    occlusionFilter.frequency.value = 18000;
    occlusionGain.gain.value = 1;
    input.connect(panner);
    panner.connect(occlusionFilter);
    occlusionFilter.connect(occlusionGain);
    occlusionGain.connect(destination);

    const emitter = {
      input,
      panner,
      occlusionFilter,
      occlusionGain,
      position: toVector3(position, new THREE.Vector3()),
      spatial: this,
      update: (nextPosition) => {
        toVector3(nextPosition, emitter.position);
        setPannerPosition(panner, emitter.position, ctx.currentTime);
        emitter.updateOcclusion();
      },
      updateOcclusion: () => {
        const listener = this.listenerProvider?.();
        if (listener?.camera) {
          listener.camera.getWorldPosition(_listenerPos);
        } else {
          toVector3(listener?.position ?? listener, _listenerPos);
        }
        const source = toVector3(emitter.position, _sourcePos);
        const raw = this.sampleOcclusion?.(_listenerPos, source) ?? 0;
        const occlusion = clamp01(raw);
        const distance = _listenerPos.distanceTo(source);
        const distanceDull = clamp01((distance - 12) / 18) * 0.25;
        const amount = clamp01(occlusion + distanceDull);
        setParam(occlusionGain.gain, THREE.MathUtils.lerp(1, 0.38, amount), ctx.currentTime);
        setParam(occlusionFilter.frequency, THREE.MathUtils.lerp(18000, 850, amount), ctx.currentTime);
      },
      dispose: () => {
        this.emitters.delete(emitter);
        input.disconnect();
        panner.disconnect();
        occlusionFilter.disconnect();
        occlusionGain.disconnect();
      },
    };

    emitter.update(position);
    this.emitters.add(emitter);
    return emitter;
  }
}
