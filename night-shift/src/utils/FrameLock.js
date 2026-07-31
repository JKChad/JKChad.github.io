/**
 * Display-synced RAF with fixed 60Hz simulation and capped 60Hz render.
 * Simulate N steps, render at most once per 1/60s (skip extra high-refresh frames).
 */
export class FrameLock {
  constructor(targetFps = 60) {
    this.targetFps = targetFps;
    this.fixedDt = 1 / targetFps;
    this.maxSteps = 4;
    this.maxFrameDt = 0.05;
    this.rafId = 0;
    this.running = false;
    this.accumulator = 0;
    this.renderAccumulator = 0;
    this.lastTime = 0;
    this.fps = 60;
    this.measuredFps = 60;
    this._fpsFrames = 0;
    this._fpsTime = 0;
    this._onSim = null;
    this._onRender = null;
  }

  /**
   * @param {(dt: number) => void} onSim fixed-timestep simulation
   * @param {((alpha: number) => void)=} onRender capped to targetFps
   */
  start(onSim, onRender) {
    this.stop();
    this._onSim = onSim;
    this._onRender = onRender || null;
    this.running = true;
    this.accumulator = 0;
    this.renderAccumulator = 0;
    this.lastTime = performance.now();
    this._fpsFrames = 0;
    this._fpsTime = this.lastTime;

    const loop = (now) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);

      let frameDt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (frameDt > this.maxFrameDt) frameDt = this.maxFrameDt;

      this.accumulator += frameDt;
      this.renderAccumulator += frameDt;

      let steps = 0;
      while (this.accumulator >= this.fixedDt && steps < this.maxSteps) {
        this._onSim?.(this.fixedDt);
        this.accumulator -= this.fixedDt;
        steps++;
      }
      if (steps >= this.maxSteps) this.accumulator = 0;

      // Cap rendering to targetFps even on 120/144Hz displays.
      if (this.renderAccumulator >= this.fixedDt) {
        const alpha = this.accumulator / this.fixedDt;
        if (this._onRender) this._onRender(alpha);
        // Keep leftover under one frame to avoid drift without multi-render catchup.
        this.renderAccumulator %= this.fixedDt;

        this._fpsFrames++;
        const elapsed = now - this._fpsTime;
        if (elapsed >= 500) {
          this.fps = Math.round((this._fpsFrames * 1000) / elapsed);
          this.measuredFps = this.fps;
          this._fpsFrames = 0;
          this._fpsTime = now;
        }
      }
    };

    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }
}
