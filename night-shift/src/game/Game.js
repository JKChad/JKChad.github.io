import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EventBus } from './EventBus.js';
import { AttentionMeter } from './AttentionMeter.js';
import { Economy } from './Economy.js';
import { ModeManager } from './ModeManager.js';
import { AudioManager } from '../audio/AudioManager.js';
import { installAudio } from '../audio/installAudio.js';
import { HUD } from '../ui/HUD.js';
import { FPSController } from '../player/FPSController.js';
import { WeaponSystem } from '../player/WeaponSystem.js';
import { Room } from '../world/Room.js';
import { LightSystem } from '../world/LightSystem.js';
import { Guard } from '../guards/Guard.js';
import { PerceptionSystem } from '../guards/PerceptionSystem.js';
import { GuardDirector } from '../guards/GuardDirector.js';
import { PartnerGhost } from '../player/PartnerGhost.js';
import { CombatSystem } from '../combat/CombatSystem.js';
import { PostFx } from '../rendering/PostFx.js';
import { FrameLock } from '../utils/FrameLock.js';
import { PerfBudget } from '../utils/PerfBudget.js';
import { LocalInputSystem } from '../input/LocalInputSystem.js';
import { installLevels } from '../levels/installLevels.js';
import { InvoiceLedger, MercStats, DroneLoadout } from '../core/economy/EconomyModel.js';

const EMPTY_ARRAY = Object.freeze([]);

/**
 * Full-build orchestrator — stealth conversation, light-as-map,
 * host-authoritative net hooks, multi-level contracts.
 */
export class Game {
  constructor(container, uiRoot) {
    this.container = container;
    this.bus = new EventBus();
    this.audio = new AudioManager();
    this.attention = new AttentionMeter(this.bus);
    this.economy = new Economy(this.bus);
    this.ledger = new InvoiceLedger(CONFIG.economy);
    this.stats = new MercStats();
    this.drone = new DroneLoadout();
    this.modes = new ModeManager(this.bus);
    this.hud = new HUD(uiRoot);
    this.input = new LocalInputSystem();
    this.input.bindDefaults();
    this.input.setPointerLookSeat(0);

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
    this._budgetSnapshot = this.perf.snapshot();
    this._lastRenderTime = performance.now();
    this._livingGuards = [];
    this._threatPositions = [];
    this._nearestGuard = null;
    this._nearestGuardDistanceSq = Infinity;
    this._hudMeterAccum = 0;
    this.objective = {
      extracted: false,
      extractRadius: 2.2,
      extractPos: new THREE.Vector3(12.5, 0, 8.5),
    };
    this.levelId =
      new URLSearchParams(window.location.search).get('level') || 'level01_archives';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07090d);
    this.scene.fog = new THREE.FogExp2(0x07090d, 0.028);

    this.clock = new THREE.Clock();
    this.frameLock = new FrameLock(CONFIG.targetFps);
    this.running = false;
    this._fpsAccum = 0;
    this._fpsFrames = 0;

    // Fallback single-room slice, then optionally replaced by light-first levels.
    this.room = new Room(this.scene, this.bus);
    this.lights = new LightSystem(this.scene, this.bus, this.room);
    this.lights.applyBudget?.(this._budgetSnapshot);
    this.player = new FPSController(this.scene, this.bus, this.renderer.domElement);
    this.weapon = new WeaponSystem(this.player, this.bus, this.audio);
    this.partner = new PartnerGhost(this.scene, this.attention);
    this.combat = new CombatSystem(this.scene, this.bus, this.audio, this.lights, this.economy);

    this.guardDirector = new GuardDirector(this.scene, this.bus, {
      lights: this.lights,
      attention: this.attention,
      modes: this.modes,
      room: this.room,
      autoSpawn: { id: 'patrol-0' },
    });
    this.guard = this.guardDirector.guards[0] || new Guard(this.scene, this.bus, this.room.patrolPath);
    this.perception = this.guardDirector.perception || new PerceptionSystem(
      this.scene,
      this.bus,
      this.lights,
      this.attention,
      this.modes,
    );

    this.post = new PostFx(this.renderer, this.scene, this.player.camera, this._budgetSnapshot);
    this.audioSystems = installAudio(this);

    try {
      installLevels(this, { levelId: this.levelId });
      // Resync director after level swap replaces lights/room.
      this.guardDirector.lights = this.lights;
      this.guardDirector.room = this.room;
      this.guardDirector.perception.lights = this.lights;
      this.guardDirector.spawnGuard({ id: 'patrol-1', index: 1 });
      this.lights.applyBudget?.(this._budgetSnapshot);
    } catch (err) {
      console.warn('Level install failed; using Room fallback.', err);
    }

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
      this.ledger.onWentLoud();
      for (const g of this.guardDirector?.guards ?? [this.guard]) g?.enterCombat?.();
      this.combat.spawnReinforcements();
    });
    this.bus.on('weapon:ammo', ({ mag, reserve }) => this.hud.setAmmo(mag, reserve));
    this.bus.on('weapon:selected', ({ weapon }) => {
      if (weapon?.hudName) {
        this.hud.el.hint.textContent = `${weapon.hudName} · C swap · E hide body · G gadget · X cycle`;
      }
    });
    this.bus.on('gadget:selected', ({ gadget, charges }) => {
      if (gadget?.hudName) this.hud.el.hint.textContent = `${gadget.hudName} x${charges} · G deploy`;
    });
    this.bus.on('gadget:empty', ({ gadget }) => {
      this.hud.el.hint.textContent = `${gadget?.hudName ?? 'GADGET'} dry`;
    });
    this.bus.on('gadget:attentionSpike', ({ amount }) => {
      this.attention.spikeLocal(amount ?? CONFIG.attention.distractionSpike);
      this.ledger.onGadget();
    });
    this.bus.on('gadget:used', () => this.ledger.onGadget());
    this.bus.on('regroup:started', () => this.hud.banner('REGROUP', 2.4));
    this.bus.on('regroup:reached', () => {
      this.hud.banner('RESUPPLIED — PUSH', 1.8);
      this.stats.add('nerve', 1);
    });
    this.bus.on('weapon:ads', (ads) => this.hud.setAds(ads));
    this.bus.on('economy:updated', (snap) => this.hud.setInvoice(snap.net ?? this.ledger.net()));
    this.bus.on('player:distract', ({ kind }) => {
      const spike =
        kind === 'shot'
          ? CONFIG.attention.shotSpike
          : kind === 'cough'
            ? CONFIG.attention.coughSpike
            : CONFIG.attention.distractionSpike;
      this.attention.spikeLocal(spike);
      this.audio.play(kind === 'can' ? 'can' : 'cough');
      this.guardDirector?.hear?.(this.player.position, kind);
      this.guard?.hearNoise?.(this.player.position, kind);
    });
    this.bus.on('reload:phase', ({ phase }) => {
      if (phase === 'magOut' || phase === 'magIn' || phase === 'rack') this.audio.play('reload');
    });
    this.bus.on('weapon:fired', (payload) => {
      this.economy.onShot();
      this.ledger.onShot();
      if (this.modes.isStealth) {
        this.attention.spikeLocal(payload.attentionSpike ?? CONFIG.attention.shotSpike);
        this.modes.tripAlarm('gunfire');
      }
      this.combat.handleShot(payload);
    });
    this.bus.on('light:broken', () => {
      this.economy.onPropertyDamage();
      this.ledger.onPropertyDamage();
    });
    this.bus.on('guard:spotted', () => this.modes.tripAlarm('spotted'));
    this.bus.on('alert:body-found', () => {
      this.ledger.onBodyFound();
      this.hud.banner('BODY FOUND — HEAT RISING', 2);
      this.hud.setInvoice(this.ledger.net());
    });
    this.bus.on('player:health', ({ hp }) => {
      if (hp <= 35) this.hud.el.hint.textContent = `Vitals ${Math.max(0, Math.round(hp))} — extract or regroup`;
    });
    this.bus.on('player:downed', () => {
      this.hud.banner('DOWNED — CONTRACT VOID', 3.5);
      this.economy.invoice.hazardPay += 2500;
      this.ledger.lines.hazardPay += 2500;
      this.hud.setInvoice(this.ledger.net());
    });
    this.bus.on('level:loaded', ({ level }) => {
      this.hud.el.hint.textContent = `${level?.title ?? 'CONTRACT'} · F distract · 1/2 attention · Gadget G`;
    });
  }

  async start() {
    await this.audio.unlock();
    this.player.lockPointer();
    this.hud.setAttention(this.attention.p1, this.attention.p2);
    this.hud.setAmmo(CONFIG.weapon.magSize, CONFIG.weapon.reserve);
    this.hud.setInvoice(this.ledger.net());
    this.hud.setMode('stealth');
    this.running = true;
    this.clock.start();
    this._lastRenderTime = performance.now();
    this.frameLock.start(
      (dt) => this._simulate(dt),
      () => this._render(),
    );
  }

  _pollInput(dt) {
    const frames = this.input.poll(dt);
    const seat0 = this.input.getSeat(0);
    const frame0 = frames[0] || seat0?.frame;
    if (frame0?.holdAttention) this.bus.emit('attention:transfer', { dir: 1 });
    else if (frame0?.releaseAttention) this.bus.emit('attention:transfer', { dir: -1 });
    else if (seat0?.released?.('holdAttention') || seat0?.released?.('releaseAttention')) {
      this.bus.emit('attention:transfer', { dir: 0 });
    }

    const seat1 = this.input.getSeat(1);
    const frame1 = frames[1] || seat1?.frame;
    if (frame1?.distract && !globalThis.__nightShiftNet?.bridge?.connected) {
      this.bus.emit('player:distract', { kind: 'cough', seat: 1 });
    }
    return frames;
  }

  _collectLivingGuards() {
    const out = this._livingGuards;
    out.length = 0;
    const guards = this.guardDirector?.guards;
    if (Array.isArray(guards)) {
      for (const guard of guards) {
        if (guard?.alive && guard.state !== 'dead') out.push(guard);
      }
    } else if (this.guard?.alive && this.guard.state !== 'dead') {
      out.push(this.guard);
    }
    return out;
  }

  _nearestLivingGuard(guards) {
    let nearest = null;
    let bestDistanceSq = Infinity;
    const playerPos = this.player.position;
    for (const guard of guards) {
      const distanceSq = guard.position.distanceToSquared(playerPos);
      if (distanceSq < bestDistanceSq) {
        nearest = guard;
        bestDistanceSq = distanceSq;
      }
    }
    this._nearestGuard = nearest;
    this._nearestGuardDistanceSq = bestDistanceSq;
    return nearest;
  }

  _threatPositionsFor(guards) {
    const out = this._threatPositions;
    out.length = 0;
    for (const guard of guards) out.push(guard.position);
    return out;
  }

  _simulate(dt) {
    if (!this.running) return;

    this._pollInput(dt);
    this.attention.update(dt);
    this.player.update(dt, this.attention.localVisibility);
    this.weapon.update(dt);

    const coverPoints = this.levelManager?.coverPoints ?? EMPTY_ARRAY;
    const shadowPoints = this.levelManager?.shadowPoints ?? EMPTY_ARRAY;
    const living = this._collectLivingGuards();
    const nearest = this._nearestLivingGuard(living);
    const guardNear = nearest && this._nearestGuardDistanceSq < 100 && (nearest.suspicion > 0.15 || this.modes.isLoud);

    this.partner.update(dt, this.player.position, this.player.yaw, {
      mode: this.modes.mode,
      guardPos: guardNear ? nearest.position : null,
      coverPoints,
      shadowPoints,
      extractPos: this.objective.extractPos,
      attentionPartnerVis: this.attention.partnerVisibility,
      threats: this._threatPositionsFor(living),
    });

    // AI seat can request distract to draw heat.
    if (this.partner.wantDistract) {
      this._partnerDistractCd = (this._partnerDistractCd ?? 0) - dt;
      if (this._partnerDistractCd <= 0) {
        this._partnerDistractCd = 4.5;
        this.attention.spikePartner(CONFIG.attention.coughSpike);
        this.guardDirector?.hear?.(this.partner.position, 'cough');
        this.audio.play('cough');
      }
    }

    this.lights.update(dt);
    if (this.guardDirector) {
      this.guardDirector.update(dt, this.player, this.partner, this.modes.mode, this.combat, {
        seat: this.input.getSeat(0),
      });
    } else {
      this.perception.update(dt, this.player, this.partner, this.guard, {
        seat: this.input.getSeat(0),
      });
      this.guard.update(dt, this.player, this.modes.mode, this.combat);
    }

    this.combat.update(dt, this.player, this.modes.mode);
    this.economy.update(dt, this.modes.mode);
    this.ledger.update(dt, this.modes.mode);
    this.audioSystems.update(dt);
    this._hudMeterAccum += dt;
    if (this._hudMeterAccum >= 0.1) {
      this._hudMeterAccum = 0;
      this.hud.setSuspicion(nearest?.suspicion ?? this.guard?.suspicion ?? 0);
      this.hud.setInvoice(this.ledger.net());
    }
    this.hud.setMode(this.modes.mode);
    this.hud.update(dt);
    this.post.update(dt, {
      mode: this.modes.mode,
      visibility: this.attention.localVisibility,
      budget: this._budgetSnapshot,
    });

    this._checkExtract();
  }

  _render() {
    if (!this.running) return;
    const now = performance.now();
    const frameDt = (now - this._lastRenderTime) / 1000;
    this._lastRenderTime = now;
    this.perf.sample(frameDt);
    this._budgetSnapshot = this.perf.snapshot();
    this.lights.applyBudget?.(this._budgetSnapshot);
    this.post.applyBudget?.(this._budgetSnapshot);
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
      const snap = this.ledger.itemized();
      if (!snap.wentLoud) this.stats.add('silence', 2);
      else this.stats.add('muscle', 1);
      this.hud.banner(snap.wentLoud ? `EXTRACTED — PAID $${snap.net}` : `CLEAN EXTRACT — $${snap.net}`, 4);
      this.hud.el.hint.textContent = snap.wentLoud
        ? `Loud finish. Stats S${this.stats.get('silence')}/M${this.stats.get('muscle')}/T${this.stats.get('tech')}/N${this.stats.get('nerve')}`
        : `Stealth bonus banked. Stats S${this.stats.get('silence')}/M${this.stats.get('muscle')}/T${this.stats.get('tech')}/N${this.stats.get('nerve')}`;
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
