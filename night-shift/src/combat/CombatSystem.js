import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Hitscan, HITSCAN_LAYERS, getHitRoot, isEnemyObject, isPlayerObject } from './Hitscan.js';
import { Decals } from './Decals.js';
import { Ragdoll } from './Ragdoll.js';
import { BreakableLights } from './BreakableLights.js';

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
    this._onGuardShot = (payload) => this.handleGuardShot(payload);

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
  }

  handleShot(payload = {}) {
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
      const position = this._spawnPoint(i, reservedPositions);
      if (!position) continue;
      reservedPositions.push(position.clone());
      const enemy = this._createEnemy(position, wave);
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
    this._ensurePlayerHurtbox(player);
    this._updateReinforcementWaves(dt, mode);
    this._updateEnemies(dt, player, mode);
    this._updateTracers(dt);
  }

  registerEnemy(object, options = {}) {
    if (!object || this.enemies.some((enemy) => enemy.root === object)) return object;
    object.userData.team ??= 'enemy';
    object.userData.isGuard ??= true;
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
      speed: options.speed ?? CONFIG.guard.chaseSpeed * 0.82,
      shootCooldown: 0.4 + Math.random() * 0.8,
      burstRemaining: 0,
      burstSeed: options.burstSeed ?? Math.random() * 10,
      strafePhase: options.strafePhase ?? Math.random() * Math.PI * 2,
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
      system: this,
    };

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

  _createEnemy(position, wave = 1) {
    const root = new THREE.Group();
    root.name = 'hostile-reinforcement';
    root.position.copy(position);
    root.userData.team = 'enemy';
    root.userData.isGuard = true;
    root.userData.combatEnemy = true;
    root.userData.maxHealth = 100;
    root.userData.health = 100;
    root.userData.combatLayer = HITSCAN_LAYERS.enemies;

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.78, 4, 8), this.enemyMaterial);
    body.name = 'hostile-body';
    body.position.y = 1.02;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), this.enemyAccentMaterial);
    head.name = 'hostile-head';
    head.position.y = 1.62;
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.58, 0.13), this.enemyMaterial);
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

    this.enemyRoot.add(root);
    this.hitscan.registerCandidate(root, HITSCAN_LAYERS.enemies);
    const burstSeed = Math.random() * 10;
    return {
      root,
      alive: true,
      speed: CONFIG.guard.chaseSpeed * (0.76 + Math.random() * 0.18),
      shootCooldown: 0.65 + Math.random() * 0.9,
      burstRemaining: 0,
      burstSeed,
      strafePhase: burstSeed,
      wave,
    };
  }

  _spawnPoint(index, reservedPositions = []) {
    const halfW = CONFIG.room.width / 2 - 1.4;
    const halfD = CONFIG.room.depth / 2 - 1.4;
    const anchors = [
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
      if (!enemy.alive || enemy.root.userData.dead) continue;
      const root = enemy.root;
      root.userData.health ??= root.userData.maxHealth ?? 100;

      _dir.subVectors(_playerPos, root.position);
      _dir.y = 0;
      const distance = _dir.length();
      if (distance > 0.001) _dir.multiplyScalar(1 / distance);

      if (mode === 'loud') {
        if (distance > 1.45) {
          _right.set(_dir.z, 0, -_dir.x);
          const strafe = Math.sin((enemy.strafePhase += dt * (1.25 + (enemy.burstSeed % 0.45)))) * 0.34;
          root.position.addScaledVector(_dir, enemy.speed * dt);
          root.position.addScaledVector(_right, enemy.speed * strafe * dt);
          this._clampToRoom(root.position);
        }
        groundLookAt(root, _playerPos);
        enemy.shootCooldown -= dt;
        if (distance < 22 && enemy.shootCooldown <= 0) {
          if (enemy.burstRemaining <= 0) {
            enemy.burstRemaining = 2 + Math.floor(Math.abs(Math.sin(enemy.burstSeed)) * 2);
          }
          this._enemyShoot(enemy, _playerPos, distance);
          enemy.burstRemaining -= 1;
          if (enemy.burstRemaining > 0) {
            enemy.shootCooldown = 0.09 + Math.abs(Math.sin(enemy.burstSeed * 1.37)) * 0.055;
          } else {
            enemy.burstSeed += 1.731;
            enemy.shootCooldown = 1.05 + Math.random() * 0.95;
          }
        }
      }
    }
  }

  _enemyShoot(enemy, playerEye, distance) {
    enemy.root.getWorldPosition(_shotStart);
    _shotStart.y += 1.45;
    _shotEnd.copy(playerEye);
    _dir.subVectors(_shotEnd, _shotStart).normalize();
    const accuracy = this._enemyAccuracy(distance);
    const spread = THREE.MathUtils.lerp(0.085, 0.012, accuracy) * (0.85 + Math.random() * 0.3);
    this._applyEnemySpread(_dir, spread);

    const maxDistance = Math.min(28, distance + 1.5);
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
        damage: Math.round(THREE.MathUtils.lerp(4, 8, accuracy)),
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

  _updateReinforcementWaves(dt, mode) {
    if (mode !== 'loud' || this._secondWaveTimer === null || this._reinforcementWave >= 2) return;
    this._secondWaveTimer -= dt;
    if (this._secondWaveTimer <= 0 && this._waveDefeated(1)) {
      const spawned = this.spawnReinforcements({ wave: 2 });
      if (spawned.length > 0) this._secondWaveTimer = null;
      else this._secondWaveTimer = 1;
    }
  }

  _waveDefeated(wave) {
    return !this.enemies.some((enemy) => enemy.wave === wave && enemy.alive && !enemy.root.userData.dead);
  }

  _enemyAccuracy(distance) {
    return THREE.MathUtils.clamp(1 - Math.max(0, distance - 4) / 20, 0.18, 0.92);
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
