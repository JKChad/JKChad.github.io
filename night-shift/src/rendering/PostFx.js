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

function smaaPresetFor(quality = 'medium') {
  return quality === 'low'
    ? (SMAAPreset?.LOW ?? SMAAPreset?.MEDIUM)
    : SMAAPreset?.MEDIUM;
}

export class PostFx {
  constructor(renderer, scene, camera, initialBudget = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this._lastDt = 0;
    this._reflectionFallback = null;
    this._budget = {
      bloomEnabled: true,
      smaaEnabled: true,
      smaaQuality: 'medium',
      ssrEnabled: true,
      ...initialBudget,
    };

    // UnsignedByte is far more stable on iGPU / SwiftShader than HalfFloat.
    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.UnsignedByteType,
      multisampling: 0,
      stencilBuffer: false,
    });
    this._softwareGl = false;
    try {
      const gl = renderer.getContext?.();
      const debug = gl?.getExtension?.('WEBGL_debug_renderer_info');
      const rendererStr = debug
        ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) || '')
        : '';
      this._softwareGl = /swiftshader|llvmpipe|softpipe/i.test(rendererStr);
    } catch {
      this._softwareGl = false;
    }

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new BloomEffect({
      intensity: 0.18,
      luminanceThreshold: 0.9,
      luminanceSmoothing: 0.13,
      mipmapBlur: true,
      radius: 0.42,
      levels: 4,
    });

    const initialPixelRatio = initialBudget.pixelRatio ?? renderer.getPixelRatio?.() ?? 1;
    const smaaQuality = initialBudget.smaaQuality ?? (initialPixelRatio <= 0.9 ? 'low' : 'medium');
    this.smaa = new SMAAEffect({ preset: smaaPresetFor(smaaQuality) });
    this.vignette = new VignetteEffect({
      technique: VignetteTechnique?.ESKIL,
      offset: 0.38,
      darkness: 0.38,
    });
    this.grain = new FilmGrainEffect({
      intensity: 0.018,
      contrast: 1.025,
    });

    const allowSsr = !this._softwareGl && this._budget.ssrEnabled !== false && initialPixelRatio > 1;
    this.ssr = allowSsr ? this._tryCreateSSR() : null;
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
    this.applyBudget(this._budget);

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
    const postDisabled =
      this._budget?.bloomEnabled === false &&
      this._budget?.smaaEnabled === false &&
      (!this.ssrPass || this.ssrPass.enabled === false);
    const degraded = this._softwareGl || postDisabled;
    if (this._softwareGl || degraded) {
      this.renderer.render(this.scene, this.camera);
    } else {
      try {
        this.composer.render(this._lastDt);
      } catch {
        this.renderer.render(this.scene, this.camera);
      }
    }
    this._lastDt = 0;
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
  }

  applyBudget(snapshot = {}) {
    this._budget = snapshot || this._budget;
    const bloomEnabled = snapshot.bloomEnabled !== false;
    const smaaEnabled = snapshot.smaaEnabled !== false;
    const pixelRatio = snapshot.pixelRatio ?? this.renderer.getPixelRatio?.() ?? 1;
    const ssrEnabled = snapshot.ssrEnabled !== false && pixelRatio > 1;

    if (this.bloomPass) this.bloomPass.enabled = bloomEnabled;
    if (this.smaaPass) this.smaaPass.enabled = smaaEnabled;
    if (this.ssrPass) this.ssrPass.enabled = ssrEnabled;
  }

  update(dt, { mode = 'stealth', visibility = 1, budget = null } = {}) {
    this._lastDt = dt;
    if (budget) this.applyBudget(budget);

    const ghost = THREE.MathUtils.clamp(1 - visibility, 0, 1);
    const loud = mode === 'loud' ? 1 : 0;

    const targetBloom = 0.18 + loud * 0.06 + ghost * 0.015;
    const targetDarkness = 0.36 + loud * 0.06 - ghost * 0.03;
    const targetGrain = 0.016 + loud * 0.003 + ghost * 0.003;
    const targetContrast = 1.015 + loud * 0.015 - ghost * 0.008;

    this.bloom.intensity = damp(this.bloom.intensity, targetBloom, 5.5, dt);
    this.vignette.darkness = damp(this.vignette.darkness, targetDarkness, 4.8, dt);
    this.vignette.offset = damp(this.vignette.offset, loud ? 0.32 : 0.38, 3.6, dt);
    this.grain.intensity = damp(this.grain.intensity, targetGrain, 4.0, dt);
    this.grain.tealLift = damp(this.grain.tealLift, ghost * 0.28, 3.5, dt);
    this.grain.redPush = damp(this.grain.redPush, loud * 0.35, 4.8, dt);
    this.grain.contrast = damp(this.grain.contrast, targetContrast, 4.0, dt);

    if (this.renderer.toneMappingExposure !== undefined) {
      // Lift midtones so light pools and furniture read; darkness is authored by lights.
      const targetExposure = 1.18 + loud * 0.04 - ghost * 0.02;
      this.renderer.toneMappingExposure = damp(this.renderer.toneMappingExposure, targetExposure, 3.2, dt);
    }
  }
}
