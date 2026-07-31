import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Hitscan, HITSCAN_LAYERS, getHitRoot, isEnemyObject, isPlayerObject } from './Hitscan.js';
import { Decals } from './Decals.js';
import { Ragdoll } from './Ragdoll.js';
import { BreakableLights } from './BreakableLights.js';
import { GadgetSystem } from '../gadgets/GadgetSystem.js';
import { ENEMY_TYPE_IDS, getEnemyType, pickEnemyType } from './EnemyTypes.js';
import { RegroupDirector } from './RegroupDirector.js';

const _playerPos = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _shotStart = new THREE.Vector3();
const _shotEnd = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _fallbackUp = new THREE.Vector3(1, 0, 0);
const _spawnPoint = new THREE.Vector3();
const _spawnBox = new THREE.Box3();
const _objectBox = new THREE.Box3();
const _hurtboxBase = new THREE.Vector3();
const _hurtboxEye = new THREE.Vector3();
const _enemyFacing = new THREE.Vector3();
const _shieldOrigin = new THREE.Vector3();

function vectorFrom(value, fallback, out) {
  if (value?.isVector3) return out.copy(value);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return out.set(value.x, value.y, value.z);
  }
  return out.copy(fallback);
}

function cloneVector(value) {
  return value?.isVector3 ? value.clone() : null;
}

function snapshotHit(hit) {
  if (!hit) return null;
  return {
    object: hit.object ?? null,
    distance: hit.distance ?? 0,
    point: cloneVector(hit.point),
    normal: cloneVector(hit.normal),
    direction: cloneVector(hit.direction),
  };
}

function playerPosition(player, out) {
  if (player?.camera?.getWorldPosition) return player.camera.getWorldPosition(out);
  if (player?.position?.isVector3) return out.copy(player.position);
  if (player?.object?.getWorldPosition) return player.object.getWorldPosition(out);
  return out.set(0, CONFIG.player.eyeHeight, 0);
}

function groundLookAt(object, target) {
  _targetPos.copy(target);
  _targetPos.y = object.position.y;
  if (_targetPos.distanceToSquared(object.position) > 0.001) object.lookAt(_targetPos);
}

export class CombatSystem {
  constructor(scene, bus, audio, lights, economy) {
    this.scene = scene;
    this.bus = bus;
    this.audio = audio;
    this.lights = lights;
    this.economy = economy;

    this.hitscan = new Hitscan(scene);
    this.decals = new Decals(scene);
    this.ragdoll = new Ragdoll(scene);
    this.breakableLights = new BreakableLights(scene, bus, audio, lights);
    this.gadgets = new GadgetSystem(scene, bus, audio, lights, this);
    this.regroup = new RegroupDirector(scene, bus);
    this.enemies = [];
    this.tracers = [];
    this.tracerPool = [];
    this.tracerCursor = 0;
    this.tracerPoolSize = 28;
    this.playerHurtbox = null;
    this.playerMaxHealth = 100;
    this.playerHealth = this.playerMaxHealth;
    this.playerDowned = false;
    this._reinforcementWave = 0;
    this._secondWaveTimer = null;
    this._weaponInventory = { allMagsEmpty: false, allAmmoEmpty: false };
    this._onGuardShot = (payload) => this.handleGuardShot(payload);
    this._onGadgetUsed = (payload) => this.gadgets.use(payload);
    this._onWeaponInventory = (payload = {}) => {
      this._weaponInventory = payload;
    };
    this._onWeaponMelee = (payload) => this.handleMelee(payload);
    this._onRegroupReached = (payload) => this._handleRegroupReached(payload);

    this.enemyRoot = new THREE.Group();
    this.enemyRoot.name = 'combat-reinforcements';
    this.enemyRoot.userData.combatLayer = HITSCAN_LAYERS.enemies;
    this.scene.add(this.enemyRoot);

    this.enemyMaterial = new THREE.MeshStandardMaterial({
      color: 0x394457,
      roughness: 0.72,
      metalness: 0.04,
    });
    this.enemyAccentMaterial = new THREE.MeshStandardMaterial({
      color: 0x8c2730,
      roughness: 0.7,
      metalness: 0.03,
    });

    this._createTracerPool();
    this.bus?.on?.('guard:shot', this._onGuardShot);
    this.bus?.on?.('gadget:used', this._onGadgetUsed);
    this.bus?.on?.('weapon:inventory', this._onWeaponInventory);
    this.bus?.on?.('weapon:melee', this._onWeaponMelee);
    this.bus?.on?.('regroup:reached', this._onRegroupReached);
  }

  handleShot(payload = {}) {
    const pelletCount = Math.max(1, Math.min(12, Math.floor(payload.pellets ?? 1)));
    if (pelletCount <= 1) return this._handleSingleShot(payload);

    let firstHit = null;
    for (let i = 0; i < pelletCount; i += 1) {
      const hit = this._handleSingleShot({ ...payload, pelletIndex: i, pellets: 1 });
      if (!firstHit && hit) firstHit = snapshotHit(hit);
    }
    return firstHit;
  }

  _handleSingleShot(payload = {}) {
    const hit = this.hitscan.fire(payload);
    if (!hit) return null;

    if (this.breakableLights.isBreakableObject(hit.object)) {
      this.breakableLights.breakFromHit(hit);
      return hit;
    }

    if (isEnemyObject(hit.object)) {
      this._applyEnemyHit(hit, payload);
      return hit;
    }

    this.decals.spawn(hit);
    return hit;
  }

  handleMelee(payload = {}) {
    vectorFrom(payload.origin, new THREE.Vector3(), _shotStart);
    vectorFrom(payload.direction, new THREE.Vector3(0, 0, -1), _dir).normalize();
    const range = payload.range ?? 1.6;
    const hit = this.hitscan.fire(
      {
        origin: _shotStart,
        direction: _dir,
        spread: 0,
        ads: true,
        maxDistance: range,
      },
      { layers: [HITSCAN_LAYERS.enemies], maxDistance: range }
    );
    if (hit && isEnemyObject(hit.object)) {
      this._applyEnemyHit(hit, { ...payload, melee: true, damage: payload.damage ?? 28 });
      return hit;
    }
    return null;
  }

  handleGuardShot(payload = {}) {
    vectorFrom(payload.origin, new THREE.Vector3(), _shotStart);
    vectorFrom(payload.direction ?? payload.dir, new THREE.Vector3(0, 0, -1), _dir).normalize();
    if (_dir.lengthSq() < 0.001) return null;

    const spread = payload.spread ?? 0.018;
    this._applyEnemySpread(_dir, spread);

    const maxDistance = payload.maxDistance ?? 28;
    const hit = this.hitscan.fire(
      {
        origin: _shotStart,
        direction: _dir,
        spread: 0,
        ads: true,
        maxDistance,
      },
      { layers: [HITSCAN_LAYERS.world, HITSCAN_LAYERS.player], maxDistance }
    );

    this.audio?.play?.('shot');
    if (hit && isPlayerObject(hit.object)) {
      this._spawnTracer(_shotStart, hit.point, 0xff4f3f);
      this._damagePlayerFromHit(hit, {
        damage: payload.damage ?? 7,
        source: payload.guard?.mesh ?? payload.guard ?? null,
        guard: payload.guard ?? null,
        origin: _shotStart,
        direction: hit.direction ?? _dir,
      });
      return hit;
    }

    if (hit) {
      this.decals.spawn(hit, { size: 0.08, spark: true });
      this._spawnTracer(_shotStart, hit.point, 0xff7d55);
      return hit;
    }

    _shotEnd.copy(_shotStart).addScaledVector(_dir, maxDistance);
    this._spawnTracer(_shotStart, _shotEnd, 0xff7d55);
    return null;
  }

  spawnReinforcements(options = {}) {
    const living = this.enemies.filter((enemy) => enemy.alive).length;
    if (living >= 6) return [];

    const wave = options.wave ?? (this._reinforcementWave === 0 ? 1 : this._reinforcementWave + 1);
    const count = Math.min(6 - living, options.count ?? 2 + Math.floor(Math.random() * 2));
    const spawned = [];
    const reservedPositions = [];
    for (let i = 0; i < count; i++) {
      const typeDef = getEnemyType(options.type ?? pickEnemyType(wave).id);
      const position = this._spawnPoint(i, reservedPositions, typeDef);
      if (!position) continue;
      reservedPositions.push(position.clone());
      const enemy = this._createEnemy(position, wave, typeDef);
      this.enemies.push(enemy);
      spawned.push(enemy.root);
    }

    if (spawned.length > 0) {
      this._reinforcementWave = Math.max(this._reinforcementWave, wave);
      if (wave === 1 && this._secondWaveTimer === null) this._secondWaveTimer = 12;
    }

    this.bus?.emit?.('combat:reinforcements', { count: spawned.length, enemies: spawned, wave });
    return spawned;
  }

  update(dt, player, mode) {
    this.ragdoll.update(dt);
    this.decals.update(dt);
    this.breakableLights.update(dt);
    this.gadgets.update(dt);
    this._ensurePlayerHurtbox(player);
    this._updateReinforcementWaves(dt, mode);
    this._updateEnemies(dt, player, mode);
    this.regroup.update(dt, {
      mode,
      player,
      playerHealth: this.playerHealth,
      allMagsEmpty: this._weaponInventory?.allMagsEmpty === true || this._weaponInventory?.allAmmoEmpty === true,
    });
    this._updateTracers(dt);
  }

  registerEnemy(object, options = {}) {
    if (!object || this.enemies.some((enemy) => enemy.root === object)) return object;
    const typeDef = getEnemyType(options.type ?? object.userData?.enemyType ?? ENEMY_TYPE_IDS.rusher);
    object.userData.team ??= 'enemy';
    object.userData.isGuard ??= true;
    object.userData.enemyType ??= typeDef.id;
    object.userData.maxHealth ??= options.maxHealth ?? 100;
    object.userData.health ??= object.userData.maxHealth;
    object.traverse?.((child) => {
      child.userData.team ??= 'enemy';
      child.userData.isGuard ??= true;
      child.userData.hitRoot = object;
      child.userData.combatLayer = HITSCAN_LAYERS.enemies;
    });
    this.hitscan.registerCandidate(object, HITSCAN_LAYERS.enemies);
    this.enemies.push({
      root: object,
      alive: true,
      type: typeDef.id,
      def: typeDef,
      speed: options.speed ?? CONFIG.guard.chaseSpeed * 0.82 * typeDef.speedMul,
      shootCooldown: 0.4 + Math.random() * 0.8,
      burstRemaining: 0,
      burstSeed: options.burstSeed ?? Math.random() * 10,
      strafePhase: options.strafePhase ?? Math.random() * Math.PI * 2,
      stunTimer: 0,
      repairTimer: 0,
      repairTarget: null,
      external: true,
    });
    return object;
  }

  unregisterEnemy(object) {
    const index = this.enemies.findIndex((enemy) => enemy.root === object);
    if (index >= 0) this.enemies.splice(index, 1);
    this.hitscan.unregisterCandidate(object);
  }

  _applyEnemyHit(hit, payload) {
    const enemy = this._enemyRootFor(hit.object);
    if (!enemy || enemy.userData.dead) return;

    const damage = payload.damage ?? CONFIG.weapon.damage;
    const event = {
      damage,
      hit,
      origin: payload.origin,
      direction: hit.direction ?? payload.direction,
      ads: payload.ads === true,
      melee: payload.melee === true,
      weaponId: payload.weaponId,
      system: this,
    };

    if (this._shieldBlocks(enemy, event)) {
      this.decals.spawn(hit, { size: 0.11, spark: true, surface: 'metal' });
      this.audio?.play?.('hit');
      this.bus?.emit?.('combat:enemyBlocked', { enemy, hit, weaponId: payload.weaponId });
      return;
    }

    let handled = false;
    let result = null;
    const guardController = this._guardControllerFor(enemy, hit.object);
    if (guardController?.takeDamage) {
      handled = true;
      guardController.takeDamage(damage, hit.point, event.direction);
      result = {
        dead: guardController.alive === false || guardController.state === 'dead' || enemy.userData.dead === true,
      };
    }

    const handler = this._hitHandlerFor(enemy, hit.object);
    if (!handled && handler) {
      handled = true;
      result = handler.call(enemy, event);
    }

    this.bus?.emit?.('combat:enemyHit', { enemy, damage, hit });
    this.bus?.emit?.('guard:hit', { guard: enemy, damage, hit });
    this.audio?.play?.('hit');

    if (handled) {
      if (result?.dead || result?.killed || enemy.userData.dead || enemy.userData.health <= 0) {
        this._killEnemy(enemy, hit, event.direction, { emitGuardKilled: !guardController });
      }
      return;
    }

    enemy.userData.maxHealth ??= 100;
    enemy.userData.health ??= enemy.userData.maxHealth;
    enemy.userData.health -= damage;
    if (enemy.userData.health <= 0) this._killEnemy(enemy, hit, event.direction);
  }

  damageEnemyDirect(enemy, amount = 0, options = {}) {
    const root = this._enemyRootFor(enemy) ?? enemy;
    if (!root || root.userData?.dead || root.userData?.incapacitated) return false;
    root.userData.maxHealth ??= 100;
    root.userData.health ??= root.userData.maxHealth;
    root.userData.health -= Math.max(0, amount);
    this.bus?.emit?.('combat:enemyHit', { enemy: root, damage: amount, source: options.source ?? null });
    if (root.userData.health <= 0) {
      this._killEnemy(root, null, options.direction ?? new THREE.Vector3(0, 0, -1));
      return true;
    }
    return false;
  }

  stunEnemy(enemy, seconds = 1.5, options = {}) {
    const root = this._enemyRootFor(enemy) ?? enemy;
    if (!root || root.userData?.dead || root.userData?.incapacitated) return false;
    root.userData.combatStunTimer = Math.max(root.userData.combatStunTimer ?? 0, seconds);
    if (options.source) root.userData.combatStunSource = options.source;
    const tracked = this.enemies.find((entry) => entry.root === root);
    if (tracked) tracked.stunTimer = Math.max(tracked.stunTimer ?? 0, seconds);
    this.bus?.emit?.('combat:enemyStunned', { enemy: root, seconds, source: options.source ?? null });
    return true;
  }

  incapacitateEnemy(enemy, options = {}) {
    const root = this._enemyRootFor(enemy) ?? enemy;
    if (!root || root.userData?.dead || root.userData?.incapacitated) return false;
    root.userData.incapacitated = true;
    root.userData.bodyState = 'incapacitated';
    root.userData.incapacitatedSeconds = options.seconds ?? 0;
    const tracked = this.enemies.find((entry) => entry.root === root);
    if (tracked) tracked.alive = false;
    this.hitscan.unregisterCandidate(root);

    const controller = options.controller ?? this._guardControllerFor(root, root);
    if (controller) {
      controller.alive = false;
      controller.state = 'incapacitated';
      controller.mesh?.traverse?.((child) => {
        child.userData.incapacitated = true;
        if (child.isLight) child.intensity = 0;
      });
    }

    this.ragdoll.spawnRagdoll(root, options.direction ?? new THREE.Vector3(0, 0, -1));
    this.bus?.emit?.('combat:enemyIncapacitated', { enemy: root, source: options.source ?? null });
    this.bus?.emit?.('guard:incapacitated', { guard: controller ?? root, source: options.source ?? null });
    return true;
  }

  _shieldBlocks(enemy, event) {
    if (enemy?.userData?.enemyType !== ENEMY_TYPE_IDS.shield || event.melee) return false;
    if ((enemy.userData.combatStunTimer ?? 0) > 0) return false;
    if (!event.origin?.isVector3) return true;

    _enemyFacing.copy(enemy.userData.combatFacingToPlayer ?? new THREE.Vector3(0, 0, 1));
    _enemyFacing.y = 0;
    if (_enemyFacing.lengthSq() <= 0.001) return true;
    _enemyFacing.normalize();

    _shieldOrigin.subVectors(event.origin, enemy.position);
    _shieldOrigin.y = 0;
    if (_shieldOrigin.lengthSq() <= 0.001) return true;
    _shieldOrigin.normalize();

    const def = getEnemyType(ENEMY_TYPE_IDS.shield);
    return _enemyFacing.dot(_shieldOrigin) >= def.frontalBlockCos;
  }

  _killEnemy(enemy, hit, direction, options = {}) {
    if (!enemy || enemy.userData.combatRagdolled) return;
    enemy.userData.dead = true;
    enemy.userData.combatRagdolled = true;
    const tracked = this.enemies.find((entry) => entry.root === enemy);
    if (tracked) tracked.alive = false;
    this.hitscan.unregisterCandidate(enemy);

    _dir.copy(direction?.isVector3 ? direction : hit?.direction ?? new THREE.Vector3(0, 0, -1));
    if (_dir.lengthSq() < 0.001) _dir.set(0, 0, -1);
    _dir.normalize();

    this.ragdoll.spawnRagdoll(enemy, _dir, hit?.point);
    this.bus?.emit?.('combat:enemyKilled', { enemy, hit });
    if (options.emitGuardKilled !== false) this.bus?.emit?.('guard:killed', { guard: enemy, hit });
  }

  _damagePlayerFromHit(hit, options = {}) {
    if (this.playerDowned || !hit) return null;

    const damage = Math.max(0, Math.round(options.damage ?? 0));
    if (damage <= 0) return null;

    this.playerHealth = Math.max(0, this.playerHealth - damage);
    const event = {
      damage,
      hp: this.playerHealth,
      maxHp: this.playerMaxHealth,
      source: options.source ?? null,
      guard: options.guard ?? null,
      origin: cloneVector(options.origin),
      point: cloneVector(hit.point),
      normal: cloneVector(hit.normal),
      direction: cloneVector(options.direction) ?? cloneVector(hit.direction),
      hit: snapshotHit(hit),
    };

    this.bus?.emit?.('player:damaged', event);
    this.bus?.emit?.('player:health', {
      hp: this.playerHealth,
      maxHp: this.playerMaxHealth,
      damage,
      source: event.source,
    });

    if (this.playerHealth <= 0 && !this.playerDowned) {
      this.playerDowned = true;
      this.bus?.emit?.('player:downed', event);
    }

    return event;
  }

  _handleRegroupReached(payload = {}) {
    this.bus?.emit?.('weapon:resupply', payload);
    if (Number.isFinite(payload.minHealth) && this.playerHealth > 0 && this.playerHealth < payload.minHealth) {
      this.playerHealth = Math.min(this.playerMaxHealth, payload.minHealth);
      this.playerDowned = false;
      this.bus?.emit?.('player:health', {
        hp: this.playerHealth,
        maxHp: this.playerMaxHealth,
        damage: 0,
        source: 'regroup',
      });
    }
    this._clearLocalPressure(payload.safeRoom, payload.pressureReliefSeconds ?? 4.5);
    this.bus?.emit?.('combat:regroupComplete', payload);
  }

  _clearLocalPressure(safeRoom, seconds = 4.5) {
    vectorFrom(safeRoom, this.regroup?.safeRoom ?? new THREE.Vector3(), _targetPos);
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.root.userData.dead) continue;
      enemy.shootCooldown = Math.max(enemy.shootCooldown, seconds);
      enemy.stunTimer = Math.max(enemy.stunTimer ?? 0, Math.min(1.4, seconds * 0.35));
      _dir.subVectors(enemy.root.position, _targetPos);
      _dir.y = 0;
      const distance = _dir.length();
      if (distance > 0.001 && distance < 8) {
        _dir.multiplyScalar(1 / distance);
        enemy.root.position.addScaledVector(_dir, 2.2);
        this._clampToRoom(enemy.root.position);
      }
    }
  }

  _enemyRootFor(object) {
    if (object?.userData?.hitRoot) return object.userData.hitRoot;
    return getHitRoot(
      object,
      (candidate) =>
        candidate.userData?.team === 'enemy' ||
        candidate.userData?.isGuard === true ||
        candidate.userData?.combatEnemy === true ||
        candidate.userData?.guard ||
        candidate.userData?.health !== undefined
    );
  }

  _guardControllerFor(enemy, object) {
    let current = object;
    while (current) {
      if (current.userData?.guard) return current.userData.guard;
      if (current === enemy) break;
      current = current.parent;
    }
    return enemy?.userData?.guard ?? null;
  }

  _hitHandlerFor(enemy, object) {
    let current = object;
    while (current) {
      if (typeof current.userData?.onHit === 'function') return current.userData.onHit;
      if (current === enemy) break;
      current = current.parent;
    }
    return typeof enemy.userData?.onHit === 'function' ? enemy.userData.onHit : null;
  }

  _createEnemy(position, wave = 1, typeDef = getEnemyType(ENEMY_TYPE_IDS.rusher)) {
    const root = new THREE.Group();
    root.name = `${typeDef.id}-reinforcement`;
    root.position.copy(position);
    root.userData.team = 'enemy';
    root.userData.isGuard = true;
    root.userData.combatEnemy = true;
    root.userData.enemyType = typeDef.id;
    root.userData.maxHealth = typeDef.health;
    root.userData.health = typeDef.health;
    root.userData.combatLayer = HITSCAN_LAYERS.enemies;

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: typeDef.color,
      roughness: 0.72,
      metalness: 0.04,
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: typeDef.accent,
      roughness: 0.68,
      metalness: 0.05,
      emissive: typeDef.id === ENEMY_TYPE_IDS.tech ? typeDef.accent : 0x000000,
      emissiveIntensity: typeDef.id === ENEMY_TYPE_IDS.tech ? 0.35 : 0,
    });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(typeDef.radius, 0.78, 4, 8), bodyMaterial);
    body.name = 'hostile-body';
    body.position.y = 1.02;
    const head = new THREE.Mesh(new THREE.SphereGeometry(typeDef.radius * 0.82, 12, 8), accentMaterial);
    head.name = 'hostile-head';
    head.position.y = 1.62;
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.58, 0.13), bodyMaterial);
    leftArm.name = 'hostile-left-arm';
    leftArm.position.set(-0.31, 1.03, 0);
    const rightArm = leftArm.clone();
    rightArm.name = 'hostile-right-arm';
    rightArm.position.x = 0.31;

    for (const part of [body, head, leftArm, rightArm]) {
      part.castShadow = true;
      part.receiveShadow = true;
      part.userData.team = 'enemy';
      part.userData.isGuard = true;
      part.userData.hitRoot = root;
      part.userData.combatLayer = HITSCAN_LAYERS.enemies;
      root.add(part);
    }

    if (typeDef.id === ENEMY_TYPE_IDS.shield) {
      const shield = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.05, 0.08), accentMaterial);
      shield.name = 'hostile-frontal-shield';
      shield.position.set(0, 1.08, -0.26);
      shield.userData.team = 'enemy';
      shield.userData.isGuard = true;
      shield.userData.hitRoot = root;
      shield.userData.combatLayer = HITSCAN_LAYERS.enemies;
      root.add(shield);
    } else if (typeDef.id === ENEMY_TYPE_IDS.tech) {
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.52, 0.12), accentMaterial);
      pack.name = 'hostile-tech-repair-pack';
      pack.position.set(0, 1.08, 0.24);
      pack.userData.team = 'enemy';
      pack.userData.isGuard = true;
      pack.userData.hitRoot = root;
      pack.userData.combatLayer = HITSCAN_LAYERS.enemies;
      root.add(pack);
    } else if (typeDef.id === ENEMY_TYPE_IDS.sniper) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 12), accentMaterial);
      barrel.name = 'hostile-sniper-long-barrel';
      barrel.rotation.x = Math.PI * 0.5;
      barrel.position.set(0.1, 1.28, -0.42);
      barrel.userData.team = 'enemy';
      barrel.userData.isGuard = true;
      barrel.userData.hitRoot = root;
      barrel.userData.combatLayer = HITSCAN_LAYERS.enemies;
      root.add(barrel);
    }

    this.enemyRoot.add(root);
    this.hitscan.registerCandidate(root, HITSCAN_LAYERS.enemies);
    const burstSeed = Math.random() * 10;
    return {
      root,
      alive: true,
      type: typeDef.id,
      def: typeDef,
      speed: CONFIG.guard.chaseSpeed * typeDef.speedMul * (0.92 + Math.random() * 0.16),
      shootCooldown: 0.65 + Math.random() * 0.9,
      burstRemaining: 0,
      burstSeed,
      strafePhase: burstSeed,
      stunTimer: 0,
      repairTimer: 0,
      repairTarget: null,
      wave,
    };
  }

  _spawnPoint(index, reservedPositions = [], typeDef = null) {
    const halfW = CONFIG.room.width / 2 - 1.4;
    const halfD = CONFIG.room.depth / 2 - 1.4;
    const anchors = typeDef?.prefersDarkCorner ? [
      [-halfW, -halfD],
      [halfW, -halfD],
      [-halfW, halfD],
      [halfW, halfD],
    ] : [
      [-halfW * 0.55, -halfD],
      [halfW * 0.55, -halfD],
      [-halfW, -halfD * 0.35],
      [halfW, -halfD * 0.35],
      [-halfW, halfD * 0.42],
      [halfW, halfD * 0.42],
      [-halfW * 0.36, halfD],
      [halfW * 0.36, halfD],
    ];

    for (let attempt = 0; attempt < 36; attempt++) {
      const anchor = anchors[(index + attempt + Math.floor(Math.random() * anchors.length)) % anchors.length];
      _spawnPoint.set(
        anchor[0] + (Math.random() - 0.5) * 2.6,
        0,
        anchor[1] + (Math.random() - 0.5) * 2.6
      );
      _spawnPoint.x = THREE.MathUtils.clamp(_spawnPoint.x, -halfW, halfW);
      _spawnPoint.z = THREE.MathUtils.clamp(_spawnPoint.z, -halfD, halfD);
      if (this._hasSpawnSpacing(_spawnPoint, reservedPositions) && this._isSpawnClear(_spawnPoint)) {
        return _spawnPoint.clone();
      }
    }

    return null;
  }

  _updateEnemies(dt, player, mode) {
    if (!player) return;
    playerPosition(player, _playerPos);

    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.root.userData.dead || enemy.root.userData.incapacitated) continue;
      const root = enemy.root;
      root.userData.health ??= root.userData.maxHealth ?? 100;
      const def = enemy.def ?? getEnemyType(enemy.type);
      enemy.def = def;

      if ((enemy.stunTimer ?? 0) > 0 || (root.userData.combatStunTimer ?? 0) > 0) {
        enemy.stunTimer = Math.max(0, (enemy.stunTimer ?? root.userData.combatStunTimer ?? 0) - dt);
        root.userData.combatStunTimer = enemy.stunTimer;
        groundLookAt(root, _playerPos);
        continue;
      }

      _dir.subVectors(_playerPos, root.position);
      _dir.y = 0;
      const distance = _dir.length();
      if (distance > 0.001) _dir.multiplyScalar(1 / distance);
      root.userData.combatFacingToPlayer = _dir.clone();

      if (mode === 'loud') {
        if (def.id === ENEMY_TYPE_IDS.tech) this._updateTech(enemy, dt);

        const desiredRange = def.desiredRange ?? 5;
        const stopRange = def.stopRange ?? 2.5;
        let advance = 0;
        if (distance > desiredRange) {
          advance = 1;
        } else if (distance < stopRange && def.id !== ENEMY_TYPE_IDS.rusher) {
          advance = -0.55;
        } else if (def.id === ENEMY_TYPE_IDS.rusher && distance > stopRange) {
          advance = 0.75;
        }

        if (Math.abs(advance) > 0.01 && distance > 0.001) {
          _right.set(_dir.z, 0, -_dir.x);
          const strafeAmp = def.id === ENEMY_TYPE_IDS.sniper ? 0.08 : def.id === ENEMY_TYPE_IDS.shield ? 0.18 : 0.34;
          const strafe = Math.sin((enemy.strafePhase += dt * (1.25 + (enemy.burstSeed % 0.45)))) * strafeAmp;
          root.position.addScaledVector(_dir, enemy.speed * advance * dt);
          root.position.addScaledVector(_right, enemy.speed * strafe * dt);
          this._clampToRoom(root.position);
        }
        groundLookAt(root, _playerPos);
        enemy.shootCooldown -= dt;
        const shootRange = def.id === ENEMY_TYPE_IDS.sniper ? 32 : 22;
        if (distance < shootRange && enemy.shootCooldown <= 0) {
          if (enemy.burstRemaining <= 0) {
            const [minBurst, maxBurst] = def.burst ?? [2, 3];
            enemy.burstRemaining = minBurst + Math.floor(Math.random() * (maxBurst - minBurst + 1));
          }
          this._enemyShoot(enemy, _playerPos, distance);
          enemy.burstRemaining -= 1;
          if (enemy.burstRemaining > 0) {
            enemy.shootCooldown = 0.09 + Math.abs(Math.sin(enemy.burstSeed * 1.37)) * 0.055;
          } else {
            enemy.burstSeed += 1.731;
            const [minCooldown, maxCooldown] = def.cooldown ?? [1.05, 2.0];
            enemy.shootCooldown = minCooldown + Math.random() * (maxCooldown - minCooldown);
          }
        }
      }
    }
  }

  _enemyShoot(enemy, playerEye, distance) {
    const def = enemy.def ?? getEnemyType(enemy.type);
    enemy.root.getWorldPosition(_shotStart);
    _shotStart.y += 1.45;
    _shotEnd.copy(playerEye);
    _dir.subVectors(_shotEnd, _shotStart).normalize();
    const accuracy = this._enemyAccuracy(distance, def);
    const spread = THREE.MathUtils.lerp(0.085, 0.012, accuracy) * (0.85 + Math.random() * 0.3);
    this._applyEnemySpread(_dir, spread);

    const maxDistance = def.id === ENEMY_TYPE_IDS.sniper ? Math.min(42, distance + 2.5) : Math.min(28, distance + 1.5);
    const hit = this.hitscan.fire(
      {
        origin: _shotStart,
        direction: _dir,
        spread: 0,
        ads: true,
        maxDistance,
      },
      { layers: [HITSCAN_LAYERS.world, HITSCAN_LAYERS.player], maxDistance }
    );

    if (hit && isPlayerObject(hit.object)) {
      this._spawnTracer(_shotStart, hit.point, 0xff4f3f);
      this.audio?.play?.('shot');
      this._damagePlayerFromHit(hit, {
        damage: Math.round((def.damage ?? 7) * THREE.MathUtils.lerp(0.82, 1.18, accuracy)),
        source: enemy.root,
        origin: _shotStart,
        direction: hit.direction ?? _dir,
      });
      return;
    }

    if (hit) {
      this.decals.spawn(hit, { size: 0.08, spark: true });
      this._spawnTracer(_shotStart, hit.point, 0xff7d55);
      this.audio?.play?.('shot');
      return;
    }

    _shotEnd.copy(_shotStart).addScaledVector(_dir, maxDistance);
    this._spawnTracer(_shotStart, _shotEnd, 0xff7d55);
    this.audio?.play?.('shot');
  }

  _ensurePlayerHurtbox(player) {
    if (!player) return;
    if (!this.playerHurtbox) {
      const geometry = new THREE.CapsuleGeometry(0.36, 1.05, 4, 8);
      const material = new THREE.MeshBasicMaterial({
        color: 0x44aaff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      material.colorWrite = false;
      this.playerHurtbox = new THREE.Mesh(geometry, material);
      this.playerHurtbox.name = 'combat-player-hurtbox';
      this.playerHurtbox.visible = true;
      this.playerHurtbox.userData.isPlayer = true;
      this.playerHurtbox.userData.combatLayer = HITSCAN_LAYERS.player;
      this.scene.add(this.playerHurtbox);
      this.hitscan.registerCandidate(this.playerHurtbox, HITSCAN_LAYERS.player);
    }

    if (player.position?.isVector3) {
      _hurtboxBase.copy(player.position);
    } else {
      playerPosition(player, _hurtboxBase);
      _hurtboxBase.y -= CONFIG.player.eyeHeight;
    }
    playerPosition(player, _hurtboxEye);
    const eyeHeight = THREE.MathUtils.clamp(
      _hurtboxEye.y - _hurtboxBase.y,
      CONFIG.player.crouchEyeHeight,
      CONFIG.player.eyeHeight
    );
    this.playerHurtbox.position.set(_hurtboxBase.x, _hurtboxBase.y + eyeHeight * 0.5, _hurtboxBase.z);
    this.playerHurtbox.scale.set(1, Math.max(0.72, eyeHeight / CONFIG.player.eyeHeight), 1);
    this.playerHurtbox.quaternion.identity();
    this.playerHurtbox.updateMatrixWorld(true);
  }

  _updateTech(enemy, dt) {
    const def = enemy.def ?? getEnemyType(ENEMY_TYPE_IDS.tech);
    const target = enemy.repairTarget?.alive === false
      ? enemy.repairTarget
      : this._nearestBrokenLight(enemy.root.position, def.repairRadius ?? 3.4);
    enemy.repairTarget = target;
    if (!target) {
      enemy.repairTimer = 0;
      return;
    }

    const distance = target.position?.distanceTo?.(enemy.root.position) ?? Infinity;
    if (distance > (def.repairRadius ?? 3.4)) {
      enemy.repairTimer = 0;
      return;
    }

    enemy.repairTimer += dt;
    enemy.shootCooldown = Math.max(enemy.shootCooldown, 0.28);
    if (enemy.repairTimer >= (def.repairSeconds ?? 3.2)) {
      this._repairLight(target);
      enemy.repairTimer = 0;
      enemy.repairTarget = null;
      enemy.shootCooldown = Math.max(enemy.shootCooldown, 0.75);
    }
  }

  _nearestBrokenLight(position, radius) {
    let best = null;
    let bestDist = Infinity;
    for (const record of this.lights?.list ?? []) {
      if (!record || record.alive !== false || !record.position) continue;
      const distance = record.position.distanceTo(position);
      if (distance <= radius && distance < bestDist) {
        best = record;
        bestDist = distance;
      }
    }
    return best;
  }

  _repairLight(record) {
    if (!record || record.alive) return false;
    record.alive = true;
    if (record.light) {
      record.light.visible = true;
      record.light.intensity = record._baseLightIntensity ?? record.light.intensity ?? 1;
    }
    if (record.pool) record.pool.visible = true;
    const bulbs = record.bulbs ?? [record.bulb];
    for (const bulb of bulbs) {
      if (!bulb) continue;
      bulb.userData.breakableLight = true;
      bulb.userData.breakableLightBroken = false;
      if (bulb.material?.emissiveIntensity !== undefined) {
        bulb.material.emissiveIntensity = record._baseEmissiveIntensity ?? 1;
      }
    }
    if (record.id !== undefined) this.breakableLights.broken.delete(String(record.id));
    this.bus?.emit?.('light:repaired', { id: record.id, position: record.position?.clone?.() });
    return true;
  }

  _updateReinforcementWaves(dt, mode) {
    if (mode !== 'loud' || this._secondWaveTimer === null || this._reinforcementWave >= 2) return;
    const techPressure = this._livingTypeCount(ENEMY_TYPE_IDS.tech) > 0 ? 1.7 : 1;
    this._secondWaveTimer -= dt * techPressure;
    if (this._secondWaveTimer <= 0 && this._waveDefeated(1)) {
      const spawned = this.spawnReinforcements({ wave: 2 });
      if (spawned.length > 0) this._secondWaveTimer = null;
      else this._secondWaveTimer = 1;
    }
  }

  _waveDefeated(wave) {
    return !this.enemies.some((enemy) => enemy.wave === wave && enemy.alive && !enemy.root.userData.dead);
  }

  _livingTypeCount(type) {
    return this.enemies.filter((enemy) => enemy.type === type && enemy.alive && !enemy.root.userData.dead).length;
  }

  _enemyAccuracy(distance, def = null) {
    const bonus = def?.accuracyBonus ?? 0;
    return THREE.MathUtils.clamp(1 - Math.max(0, distance - 4) / 20 + bonus, 0.12, 0.96);
  }

  _applyEnemySpread(direction, spread) {
    if (!Number.isFinite(spread) || spread <= 0) return;

    _right.crossVectors(direction, Math.abs(direction.dot(_worldUp)) > 0.96 ? _fallbackUp : _worldUp).normalize();
    _targetPos.crossVectors(_right, direction).normalize();
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * spread;
    direction
      .addScaledVector(_right, Math.cos(angle) * radius)
      .addScaledVector(_targetPos, Math.sin(angle) * radius)
      .normalize();
  }

  _clampToRoom(position) {
    position.x = THREE.MathUtils.clamp(position.x, -CONFIG.room.width / 2 + 0.7, CONFIG.room.width / 2 - 0.7);
    position.z = THREE.MathUtils.clamp(position.z, -CONFIG.room.depth / 2 + 0.7, CONFIG.room.depth / 2 - 0.7);
  }

  _hasSpawnSpacing(point, reservedPositions) {
    const minDistanceSq = 1.35 * 1.35;
    for (const reserved of reservedPositions) {
      if (reserved.distanceToSquared(point) < minDistanceSq) return false;
    }
    for (const enemy of this.enemies) {
      if (enemy.alive && enemy.root.position.distanceToSquared(point) < minDistanceSq) return false;
    }
    return true;
  }

  _isSpawnClear(point) {
    _spawnBox.min.set(point.x - 0.45, 0.05, point.z - 0.45);
    _spawnBox.max.set(point.x + 0.45, 1.85, point.z + 0.45);

    let clear = true;
    this.scene.traverse((object) => {
      if (!clear || !object.isMesh || !object.visible || this._isSpawnIgnored(object)) return;
      _objectBox.setFromObject(object);
      if (_objectBox.isEmpty() || _objectBox.max.y <= 0.12 || _objectBox.min.y >= CONFIG.room.height + 0.05) return;
      if (_objectBox.intersectsBox(_spawnBox)) clear = false;
    });
    return clear;
  }

  _isSpawnIgnored(object) {
    let current = object;
    while (current) {
      const data = current.userData || {};
      if (
        current === this.enemyRoot ||
        data.team === 'enemy' ||
        data.isGuard === true ||
        data.isPlayer === true ||
        data.isDecal === true ||
        data.isCombatVfx === true ||
        data.combatIgnore === true
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  _createTracerPool() {
    for (let i = 0; i < this.tracerPoolSize; i++) {
      const positions = new Float32Array(6);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({
        color: 0xff7d55,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const line = new THREE.Line(geometry, material);
      line.visible = false;
      line.userData.isCombatVfx = true;
      line.userData.combatIgnore = true;
      this.scene.add(line);
      this.tracerPool.push({
        line,
        positions,
        age: 0,
        ttl: 0.08,
        active: false,
      });
    }
  }

  _spawnTracer(start, end, color) {
    if (this.tracerPool.length === 0) return;

    const tracer = this.tracerPool[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % this.tracerPool.length;
    if (tracer.active) {
      const index = this.tracers.indexOf(tracer);
      if (index >= 0) this.tracers.splice(index, 1);
    }

    tracer.positions[0] = start.x;
    tracer.positions[1] = start.y;
    tracer.positions[2] = start.z;
    tracer.positions[3] = end.x;
    tracer.positions[4] = end.y;
    tracer.positions[5] = end.z;
    tracer.line.geometry.attributes.position.needsUpdate = true;
    tracer.line.material.color.setHex(color);
    tracer.line.material.opacity = 0.7;
    tracer.line.visible = true;
    tracer.age = 0;
    tracer.ttl = 0.08;
    tracer.active = true;
    this.tracers.push(tracer);
  }

  _updateTracers(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.age += dt;
      const life = 1 - tracer.age / tracer.ttl;
      if (life <= 0) {
        tracer.line.visible = false;
        tracer.line.material.opacity = 0;
        tracer.active = false;
        this.tracers.splice(i, 1);
      } else {
        tracer.line.material.opacity = 0.7 * life;
      }
    }
  }
}
