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
      intensity: 0.36,
      luminanceThreshold: 0.82,
      luminanceSmoothing: 0.18,
      mipmapBlur: true,
      radius: 0.46,
      levels: 5,
    });

    this.smaa = new SMAAEffect({ preset: SMAAPreset?.HIGH });
    this.vignette = new VignetteEffect({
      technique: VignetteTechnique?.ESKIL,
      offset: 0.32,
      darkness: 0.54,
    });
    this.grain = new FilmGrainEffect({
      intensity: 0.026,
      contrast: 1.045,
    });

    const effects = [];
    this.ssr = this._tryCreateSSR();
    if (this.ssr) effects.push(this.ssr);
    effects.push(this.bloom, this.smaa, this.vignette, this.grain);

    this.effectPass = new EffectPass(camera, ...effects);
    this.effectPass.dithering = true;
    this.composer.addPass(this.effectPass);

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

  update(dt, { mode = 'stealth', visibility = 1 } = {}) {
    this._lastDt = dt;

    const ghost = THREE.MathUtils.clamp(1 - visibility, 0, 1);
    const loud = mode === 'loud' ? 1 : 0;

    const targetBloom = 0.36 + loud * 0.2 + ghost * 0.04;
    const targetDarkness = 0.54 + loud * 0.1 - ghost * 0.045;
    const targetGrain = 0.026 + loud * 0.006 + ghost * 0.006;
    const targetContrast = 1.045 + loud * 0.025 - ghost * 0.015;

    this.bloom.intensity = damp(this.bloom.intensity, targetBloom, 5.5, dt);
    this.vignette.darkness = damp(this.vignette.darkness, targetDarkness, 4.8, dt);
    this.vignette.offset = damp(this.vignette.offset, loud ? 0.27 : 0.32, 3.6, dt);
    this.grain.intensity = damp(this.grain.intensity, targetGrain, 4.0, dt);
    this.grain.tealLift = damp(this.grain.tealLift, ghost * 0.72, 3.5, dt);
    this.grain.redPush = damp(this.grain.redPush, loud * 0.8, 4.8, dt);
    this.grain.contrast = damp(this.grain.contrast, targetContrast, 4.0, dt);

    if (this.renderer.toneMappingExposure !== undefined) {
      const targetExposure = 1.03 + loud * 0.05 - ghost * 0.025;
      this.renderer.toneMappingExposure = damp(this.renderer.toneMappingExposure, targetExposure, 3.2, dt);
    }
  }
}
