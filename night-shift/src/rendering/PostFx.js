import * as THREE from 'three';
import * as PP from 'postprocessing';
import { applyEnvironmentMap, captureEnvironmentMap } from './Materials.js';
import { FilmGrainEffect } from './FilmGrainPass.js';

const {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  VignetteEffect,
  VignetteTechnique,
} = PP;

function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export class PostFx {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this._lastDt = 0;
    this._reflectionFallback = null;

    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: renderer.capabilities?.isWebGL2 ? 2 : 0,
      stencilBuffer: false,
    });

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new BloomEffect({
      intensity: 0.28,
      luminanceThreshold: 0.9,
      luminanceSmoothing: 0.13,
      mipmapBlur: true,
      radius: 0.42,
      levels: 4,
    });

    this.smaa = new SMAAEffect({ preset: SMAAPreset?.MEDIUM });
    this.vignette = new VignetteEffect({
      technique: VignetteTechnique?.ESKIL,
      offset: 0.32,
      darkness: 0.5,
    });
    this.grain = new FilmGrainEffect({
      intensity: 0.018,
      contrast: 1.025,
    });

    this.ssr = this._tryCreateSSR();
    if (this.ssr) {
      this.ssrPass = new EffectPass(camera, this.ssr);
      this.composer.addPass(this.ssrPass);
    }

    this.bloomPass = new EffectPass(camera, this.bloom);
    this.smaaPass = new EffectPass(camera, this.smaa);
    this.lookPass = new EffectPass(camera, this.vignette, this.grain);
    this.lookPass.dithering = true;
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.smaaPass);
    this.composer.addPass(this.lookPass);

    if (!this.ssr) this._installReflectionFallback();

    const size = renderer.getSize(new THREE.Vector2());
    this.setSize(size.x, size.y);
  }

  _tryCreateSSR() {
    const ssrKey = `SSR${'Effect'}`;
    const SSREffect = PP[ssrKey];
    if (!SSREffect) return null;

    try {
      return new SSREffect(this.scene, this.camera, {
        intensity: 0.16,
        distance: 7.5,
        thickness: 0.08,
        roughnessFade: 0.72,
        maxRoughness: 0.62,
        blend: 0.62,
      });
    } catch (err) {
      console.warn('SSREffect unavailable, using environment reflection fallback.', err);
      return null;
    }
  }

  _installReflectionFallback() {
    try {
      this._reflectionFallback = captureEnvironmentMap(
        this.renderer,
        this.scene,
        new THREE.Vector3(0, 1.35, 0),
        { size: 128, far: 55 }
      );
      applyEnvironmentMap(this.scene, this._reflectionFallback.texture, { intensity: 0.24 });

      this.scene.traverse((obj) => {
        if (!obj.userData?.reflectiveFloor || !obj.material) return;
        obj.material.roughness = Math.min(obj.material.roughness ?? 0.7, 0.58);
        obj.material.envMapIntensity = Math.max(obj.material.envMapIntensity ?? 0, 0.62);
        obj.material.needsUpdate = true;
      });
    } catch (err) {
      console.warn('Reflection fallback capture failed; continuing with PBR materials only.', err);
    }
  }

  render() {
    this.composer.render(this._lastDt);
    this._lastDt = 0;
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
  }

  applyBudget(snapshot = {}) {
    const bloomEnabled = snapshot.bloomEnabled !== false;
    const smaaEnabled = snapshot.smaaEnabled !== false;

    if (this.bloomPass) this.bloomPass.enabled = bloomEnabled;
    if (this.smaaPass) this.smaaPass.enabled = smaaEnabled;
    if (this.ssrPass) this.ssrPass.enabled = snapshot.pixelRatio === undefined || snapshot.pixelRatio >= 0.82;
  }

  update(dt, { mode = 'stealth', visibility = 1, budget = null } = {}) {
    this._lastDt = dt;
    if (budget) this.applyBudget(budget);

    const ghost = THREE.MathUtils.clamp(1 - visibility, 0, 1);
    const loud = mode === 'loud' ? 1 : 0;

    const targetBloom = 0.28 + loud * 0.12 + ghost * 0.025;
    const targetDarkness = 0.5 + loud * 0.085 - ghost * 0.035;
    const targetGrain = 0.018 + loud * 0.004 + ghost * 0.004;
    const targetContrast = 1.025 + loud * 0.018 - ghost * 0.01;

    this.bloom.intensity = damp(this.bloom.intensity, targetBloom, 5.5, dt);
    this.vignette.darkness = damp(this.vignette.darkness, targetDarkness, 4.8, dt);
    this.vignette.offset = damp(this.vignette.offset, loud ? 0.27 : 0.32, 3.6, dt);
    this.grain.intensity = damp(this.grain.intensity, targetGrain, 4.0, dt);
    this.grain.tealLift = damp(this.grain.tealLift, ghost * 0.36, 3.5, dt);
    this.grain.redPush = damp(this.grain.redPush, loud * 0.42, 4.8, dt);
    this.grain.contrast = damp(this.grain.contrast, targetContrast, 4.0, dt);

    if (this.renderer.toneMappingExposure !== undefined) {
      const targetExposure = 1.0 + loud * 0.045 - ghost * 0.025;
      this.renderer.toneMappingExposure = damp(this.renderer.toneMappingExposure, targetExposure, 3.2, dt);
    }
  }
}
