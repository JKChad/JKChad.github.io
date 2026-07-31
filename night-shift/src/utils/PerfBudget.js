/**
 * Adaptive quality knobs for locked ~60fps on mid iGPUs.
 */
export class PerfBudget {
  constructor(renderer) {
    this.renderer = renderer;
    this.targetFrameMs = 1000 / 60;
    this.emaFrameMs = 16.6;
    this.maxPixelRatio = 1.0;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.bloomEnabled = true;
    this.smaaEnabled = true;
    this.smaaQuality = this.pixelRatio <= 0.9 ? 'low' : 'medium';
    this.shadowsEnabled = true;
    this.shadowCastersEnabled = true;
    this.grainIntensityScale = 1;
    this.shadowMapSize = 512;
    this.maxShadowCasters = 1;
    this.lightVolumesEnabled = true;
    this.ssrEnabled = this.pixelRatio > 1.0;
    this._badStreak = 0;
    this._goodStreak = 0;
    renderer.setPixelRatio(this.pixelRatio);
  }

  /** Call once per rendered frame with measured frame dt seconds. */
  sample(frameDt) {
    const ms = frameDt * 1000;
    this.emaFrameMs = this.emaFrameMs * 0.9 + ms * 0.1;

    if (this.emaFrameMs > this.targetFrameMs * 1.25) {
      this._badStreak++;
      this._goodStreak = 0;
      if (this._badStreak >= 20) {
        this._degrade();
        this._badStreak = 0;
      }
    } else if (this.emaFrameMs < this.targetFrameMs * 0.85) {
      this._goodStreak++;
      this._badStreak = 0;
      if (this._goodStreak >= 90) {
        this._upgrade();
        this._goodStreak = 0;
      }
    }
  }

  _degrade() {
    if (this.shadowsEnabled || this.shadowCastersEnabled) {
      this.shadowsEnabled = false;
      this.shadowCastersEnabled = false;
      this.renderer.shadowMap.enabled = false;
      return;
    }
    if (this.pixelRatio > 0.85) {
      this.pixelRatio = Math.max(0.85, this.pixelRatio - 0.1);
      this.renderer.setPixelRatio(this.pixelRatio);
      return;
    }
    if (this.bloomEnabled) {
      this.bloomEnabled = false;
      return;
    }
    if (this.smaaQuality !== 'low') {
      this.smaaQuality = 'low';
      return;
    }
    if (this.smaaEnabled) {
      this.smaaEnabled = false;
    }
  }

  _upgrade() {
    if (!this.smaaEnabled) {
      this.smaaEnabled = true;
      this.smaaQuality = 'low';
      return;
    }
    if (this.smaaQuality !== 'medium') {
      this.smaaQuality = 'medium';
      return;
    }
    if (!this.bloomEnabled) {
      this.bloomEnabled = true;
      return;
    }
    if (this.pixelRatio < this.maxPixelRatio) {
      this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);
      this.renderer.setPixelRatio(this.pixelRatio);
      return;
    }
    if (!this.shadowsEnabled || !this.shadowCastersEnabled) {
      this.shadowsEnabled = true;
      this.shadowCastersEnabled = true;
      this.renderer.shadowMap.enabled = true;
    }
  }

  snapshot() {
    return {
      emaFrameMs: this.emaFrameMs,
      pixelRatio: this.pixelRatio,
      bloomEnabled: this.bloomEnabled,
      smaaEnabled: this.smaaEnabled,
      smaaQuality: this.smaaQuality,
      shadowsEnabled: this.shadowsEnabled,
      shadowCastersEnabled: this.shadowCastersEnabled,
      shadowMapSize: this.shadowMapSize,
      maxShadowCasters: this.maxShadowCasters,
      lightVolumesEnabled: this.lightVolumesEnabled,
      ssrEnabled: this.ssrEnabled && this.pixelRatio > 1.0,
    };
  }
}
