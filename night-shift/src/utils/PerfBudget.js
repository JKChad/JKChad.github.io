/**
 * Adaptive quality knobs for locked ~60fps on mid iGPUs.
 */
export class PerfBudget {
  constructor(renderer) {
    this.renderer = renderer;
    this.targetFrameMs = 1000 / 60;
    this.emaFrameMs = 16.6;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
    this.bloomEnabled = true;
    this.smaaEnabled = true;
    this.shadowsEnabled = true;
    this.grainIntensityScale = 1;
    this.shadowMapSize = 512;
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
    if (this.pixelRatio > 0.85) {
      this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.15);
      this.renderer.setPixelRatio(this.pixelRatio);
      return;
    }
    if (this.smaaEnabled) {
      this.smaaEnabled = false;
      return;
    }
    if (this.bloomEnabled) {
      this.bloomEnabled = false;
      return;
    }
    if (this.shadowsEnabled) {
      this.shadowsEnabled = false;
      this.renderer.shadowMap.enabled = false;
    }
  }

  _upgrade() {
    if (!this.shadowsEnabled) {
      this.shadowsEnabled = true;
      this.renderer.shadowMap.enabled = true;
      return;
    }
    if (!this.bloomEnabled) {
      this.bloomEnabled = true;
      return;
    }
    if (!this.smaaEnabled) {
      this.smaaEnabled = true;
      return;
    }
    if (this.pixelRatio < 1.25) {
      this.pixelRatio = Math.min(1.25, this.pixelRatio + 0.1);
      this.renderer.setPixelRatio(this.pixelRatio);
    }
  }

  snapshot() {
    return {
      emaFrameMs: this.emaFrameMs,
      pixelRatio: this.pixelRatio,
      bloomEnabled: this.bloomEnabled,
      smaaEnabled: this.smaaEnabled,
      shadowsEnabled: this.shadowsEnabled,
    };
  }
}
