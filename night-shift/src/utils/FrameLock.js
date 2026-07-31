const LOGIC_FPS = 60;
const FIXED_DT = 1 / LOGIC_FPS;
const MAX_STEPS_PER_FRAME = 4;
const MAX_FRAME_SECONDS = 0.25;
const STEP_EPSILON = 0.00025;
const FPS_SAMPLE_SECONDS = 0.5;

export class FrameLock {
  constructor(targetFps = LOGIC_FPS) {
    this.targetFps = Number.isFinite(targetFps) && targetFps > 0 ? targetFps : LOGIC_FPS;
    this.fixedDt = FIXED_DT;
    this.maxSteps = MAX_STEPS_PER_FRAME;
    this.fps = 0;

    this.running = false;
    this._callback = null;
    this._rafId = 0;
    this._lastTime = 0;
    this._accumulator = 0;
    this._fpsElapsed = 0;
    this._fpsFrames = 0;
    this._tick = this._tick.bind(this);
  }

  start(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('FrameLock.start requires a callback');
    }

    this.stop();
    this.running = true;
    this._callback = callback;
    this._lastTime = performance.now();
    this._accumulator = 0;
    this._fpsElapsed = 0;
    this._fpsFrames = 0;
    this.fps = 0;
    this._rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    if (this._rafId !== 0) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }

    this.running = false;
    this._callback = null;
    this._accumulator = 0;
  }

  get measuredFps() {
    return this.fps;
  }

  _tick(now) {
    if (!this.running) return;

    this._rafId = requestAnimationFrame(this._tick);

    let frameSeconds = (now - this._lastTime) * 0.001;
    this._lastTime = now;

    if (frameSeconds < 0) frameSeconds = 0;
    if (frameSeconds > MAX_FRAME_SECONDS) frameSeconds = MAX_FRAME_SECONDS;

    this._fpsElapsed += frameSeconds;
    this._fpsFrames++;
    if (this._fpsElapsed >= FPS_SAMPLE_SECONDS) {
      this.fps = Math.round(this._fpsFrames / this._fpsElapsed);
      this._fpsElapsed = 0;
      this._fpsFrames = 0;
    }

    this._accumulator += frameSeconds;

    let steps = 0;
    while (this._accumulator + STEP_EPSILON >= FIXED_DT && steps < this.maxSteps) {
      this._callback(FIXED_DT);
      if (!this.running) return;
      this._accumulator -= FIXED_DT;
      if (this._accumulator < 0) this._accumulator = 0;
      steps++;
    }

    if (steps === this.maxSteps && this._accumulator >= FIXED_DT) {
      this._accumulator %= FIXED_DT;
    }
  }
}
