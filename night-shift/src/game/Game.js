import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EventBus } from './EventBus.js';
import { AttentionMeter } from './AttentionMeter.js';
import { Economy } from './Economy.js';
import { ModeManager } from './ModeManager.js';
import { AudioManager } from '../audio/AudioManager.js';
import { HUD } from '../ui/HUD.js';
import { FPSController } from '../player/FPSController.js';
import { WeaponSystem } from '../player/WeaponSystem.js';
import { Room } from '../world/Room.js';
import { LightSystem } from '../world/LightSystem.js';
import { Guard } from '../guards/Guard.js';
import { PerceptionSystem } from '../guards/PerceptionSystem.js';
import { PartnerGhost } from '../player/PartnerGhost.js';
import { CombatSystem } from '../combat/CombatSystem.js';
import { PostFx } from '../rendering/PostFx.js';
import { FrameLock } from '../utils/FrameLock.js';
import { PerfBudget } from '../utils/PerfBudget.js';

/**
 * Vertical slice orchestrator — wires stealth conversation, light-as-map,
 * and hard-cut loud combat into one playable room.
 */
export class Game {
  constructor(container, uiRoot) {
    this.container = container;
    this.bus = new EventBus();
    this.audio = new AudioManager();
    this.attention = new AttentionMeter(this.bus);
    this.economy = new Economy(this.bus);
    this.modes = new ModeManager(this.bus);
    this.hud = new HUD(uiRoot);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.perf = new PerfBudget(this.renderer);
    this._lastRenderTime = performance.now();
    this.objective = { extracted: false, extractRadius: 2.2, extractPos: new THREE.Vector3(12.5, 0, 8.5) };

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07090d);
    this.scene.fog = new THREE.FogExp2(0x07090d, 0.028);

    this.clock = new THREE.Clock();
    this.frameLock = new FrameLock(CONFIG.targetFps);
    this.running = false;
    this._fpsAccum = 0;
    this._fpsFrames = 0;

    this.room = new Room(this.scene, this.bus);
    this.lights = new LightSystem(this.scene, this.bus, this.room);
    this.player = new FPSController(this.scene, this.bus, this.renderer.domElement);
    this.weapon = new WeaponSystem(this.player, this.bus, this.audio);
    this.partner = new PartnerGhost(this.scene, this.attention);
    this.combat = new CombatSystem(this.scene, this.bus, this.audio, this.lights, this.economy);
    this.guard = new Guard(this.scene, this.bus, this.room.patrolPath);
    this.perception = new PerceptionSystem(this.scene, this.bus, this.lights, this.attention, this.modes);
    this.post = new PostFx(this.renderer, this.scene, this.player.camera);

    this._bindBus();
    window.addEventListener('resize', () => this._onResize());
  }

  _bindBus() {
    this.bus.on('attention:changed', ({ p1, p2 }) => this.hud.setAttention(p1, p2));
    this.bus.on('attention:transfer', ({ dir }) => this.attention.setTransfer(dir));
    this.bus.on('mode:loud', () => {
      this.hud.setMode('loud');
      this.hud.banner('COMPROMISED — FIGHT OUT');
      this.audio.play('alarm');
      this.economy.onWentLoud();
      this.guard.enterCombat();
      this.combat.spawnReinforcements();
    });
    this.bus.on('weapon:ammo', ({ mag, reserve }) => this.hud.setAmmo(mag, reserve));
    this.bus.on('weapon:ads', (ads) => this.hud.setAds(ads));
    this.bus.on('economy:updated', (snap) => this.hud.setInvoice(snap.net));
    this.bus.on('player:distract', ({ kind }) => {
      const spike =
        kind === 'shot'
          ? CONFIG.attention.shotSpike
          : kind === 'cough'
            ? CONFIG.attention.coughSpike
            : CONFIG.attention.distractionSpike;
      // Making noise draws heat onto YOU so the partner gets the ghost window.
      this.attention.spikeLocal(spike);
      this.audio.play(kind === 'can' ? 'can' : 'cough');
      this.guard.hearNoise(this.player.position, kind);
    });
    this.bus.on('reload:phase', ({ phase }) => {
      if (phase === 'magOut' || phase === 'magIn' || phase === 'rack') this.audio.play('reload');
    });
    this.bus.on('weapon:fired', (payload) => {
      this.economy.onShot();
      if (this.modes.isStealth) {
        this.attention.spikeLocal(CONFIG.attention.shotSpike);
        this.modes.tripAlarm('gunfire');
      }
      this.combat.handleShot(payload);
    });
    this.bus.on('light:broken', () => this.economy.onPropertyDamage());
    this.bus.on('guard:spotted', () => this.modes.tripAlarm('spotted'));
    this.bus.on('player:health', ({ hp }) => {
      if (hp <= 35) this.hud.el.hint.textContent = `Vitals ${Math.max(0, Math.round(hp))} — extract or bleed out`;
    });
    this.bus.on('player:downed', () => {
      this.hud.banner('DOWNED — CONTRACT VOID', 3.5);
      this.economy.invoice.hazardPay += 2500;
      this.hud.setInvoice(this.economy.net());
    });
  }

  async start() {
    await this.audio.unlock();
    this.player.lockPointer();
    this.hud.setAttention(this.attention.p1, this.attention.p2);
    this.hud.setAmmo(CONFIG.weapon.magSize, CONFIG.weapon.reserve);
    this.hud.setInvoice(this.economy.net());
    this.hud.setMode('stealth');
    this.running = true;
    this.clock.start();
    this._lastRenderTime = performance.now();
    this.frameLock.start(
      (dt) => this._simulate(dt),
      () => this._render(),
    );
  }

  _simulate(dt) {
    if (!this.running) return;

    this.attention.update(dt);
    this.player.update(dt, this.attention.localVisibility);
    this.weapon.update(dt);
    const guardNear =
      this.guard?.alive &&
      this.guard.position.distanceTo(this.player.position) < 10 &&
      (this.guard.suspicion > 0.15 || this.modes.isLoud);
    this.partner.update(dt, this.player.position, this.player.yaw, {
      mode: this.modes.mode,
      guardPos: guardNear ? this.guard.position : null,
    });
    this.lights.update(dt);
    this.perception.update(dt, this.player, this.partner, this.guard);
    this.guard.update(dt, this.player, this.modes.mode, this.combat);
    this.combat.update(dt, this.player, this.modes.mode);
    this.economy.update(dt, this.modes.mode);
    this.hud.setSuspicion(this.guard?.suspicion ?? 0);
    this.hud.setMode(this.modes.mode);
    this.hud.update(dt);
    this.post.update(dt, {
      mode: this.modes.mode,
      visibility: this.attention.localVisibility,
      budget: this.perf.snapshot(),
    });

    this._checkExtract();
  }

  _render() {
    if (!this.running) return;
    const now = performance.now();
    const frameDt = (now - this._lastRenderTime) / 1000;
    this._lastRenderTime = now;
    this.perf.sample(frameDt);
    this.post.applyBudget?.(this.perf.snapshot());
    this.post.render();

    this._fpsAccum += frameDt;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.hud.setFps(this.frameLock.fps || Math.round(this._fpsFrames / this._fpsAccum));
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }
  }

  _checkExtract() {
    if (this.objective.extracted) return;
    const d = this.player.position.distanceTo(this.objective.extractPos);
    this.hud.setExtractHint(
      d < 7.5,
      d < this.objective.extractRadius ? 'Hold position — cashing out' : 'Extract at the far door',
    );
    if (d < this.objective.extractRadius) {
      this.objective.extracted = true;
      const snap = this.economy.snapshot();
      this.hud.banner(snap.wentLoud ? `EXTRACTED — PAID $${snap.net}` : `CLEAN EXTRACT — $${snap.net}`, 4);
      this.hud.el.hint.textContent = snap.wentLoud
        ? 'Loud finish. Ammo, damage, and hazard pay came out of your cut.'
        : 'Stealth bonus banked. Attention is a conversation.';
    }
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.player.camera.aspect = w / h;
    this.player.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(this.perf.pixelRatio);
    this.post.setSize(w, h);
  }
}
