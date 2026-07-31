import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Hitscan, HITSCAN_LAYERS, getHitRoot, isEnemyObject } from './Hitscan.js';
import { Decals } from './Decals.js';
import { Ragdoll } from './Ragdoll.js';
import { BreakableLights } from './BreakableLights.js';

const _playerPos = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _shotStart = new THREE.Vector3();
const _shotEnd = new THREE.Vector3();

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

  spawnReinforcements() {
    const living = this.enemies.filter((enemy) => enemy.alive).length;
    if (living >= 6) return [];

    const count = Math.min(6 - living, 2 + Math.floor(Math.random() * 2));
    const spawned = [];
    for (let i = 0; i < count; i++) {
      const enemy = this._createEnemy(this._spawnPoint(i));
      this.enemies.push(enemy);
      spawned.push(enemy.root);
    }

    this.bus?.emit?.('combat:reinforcements', { count: spawned.length, enemies: spawned });
    return spawned;
  }

  update(dt, player, mode) {
    this.ragdoll.update(dt);
    this.decals.update(dt);
    this.breakableLights.update(dt);
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
    this.enemies.push({
      root: object,
      alive: true,
      speed: options.speed ?? CONFIG.guard.chaseSpeed * 0.82,
      shootCooldown: 0.4 + Math.random() * 0.8,
      external: true,
    });
    return object;
  }

  unregisterEnemy(object) {
    const index = this.enemies.findIndex((enemy) => enemy.root === object);
    if (index >= 0) this.enemies.splice(index, 1);
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

    _dir.copy(direction?.isVector3 ? direction : hit?.direction ?? new THREE.Vector3(0, 0, -1));
    if (_dir.lengthSq() < 0.001) _dir.set(0, 0, -1);
    _dir.normalize();

    this.ragdoll.spawnRagdoll(enemy, _dir, hit?.point);
    this.bus?.emit?.('combat:enemyKilled', { enemy, hit });
    if (options.emitGuardKilled !== false) this.bus?.emit?.('guard:killed', { guard: enemy, hit });
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

  _createEnemy(position) {
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
    return {
      root,
      alive: true,
      speed: CONFIG.guard.chaseSpeed * (0.76 + Math.random() * 0.18),
      shootCooldown: 0.65 + Math.random() * 0.9,
      burstSeed: Math.random() * 10,
    };
  }

  _spawnPoint(index) {
    const halfW = CONFIG.room.width / 2 - 1.8;
    const halfD = CONFIG.room.depth / 2 - 1.8;
    const points = [
      new THREE.Vector3(-halfW, 0, -halfD),
      new THREE.Vector3(halfW, 0, -halfD),
      new THREE.Vector3(-halfW, 0, halfD),
      new THREE.Vector3(halfW, 0, halfD),
    ];
    const point = points[(index + Math.floor(Math.random() * points.length)) % points.length].clone();
    point.x += (Math.random() - 0.5) * 2.2;
    point.z += (Math.random() - 0.5) * 2.2;
    return point;
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
          root.position.addScaledVector(_dir, enemy.speed * dt);
          root.position.x = Math.max(-CONFIG.room.width / 2 + 0.7, Math.min(CONFIG.room.width / 2 - 0.7, root.position.x));
          root.position.z = Math.max(-CONFIG.room.depth / 2 + 0.7, Math.min(CONFIG.room.depth / 2 - 0.7, root.position.z));
        }
        groundLookAt(root, _playerPos);
        enemy.shootCooldown -= dt;
        if (distance < 20 && enemy.shootCooldown <= 0) {
          this._enemyShoot(enemy, _playerPos, distance);
          enemy.shootCooldown = 1.15 + Math.random() * 1.1;
        }
      }
    }
  }

  _enemyShoot(enemy, playerEye, distance) {
    enemy.root.getWorldPosition(_shotStart);
    _shotStart.y += 1.45;
    _shotEnd.copy(playerEye);
    _dir.subVectors(_shotEnd, _shotStart).normalize();

    const obstruction = this.hitscan.fire(
      {
        origin: _shotStart,
        direction: _dir,
        spread: 0.012,
        ads: true,
        maxDistance: distance,
      },
      { layers: [HITSCAN_LAYERS.world], maxDistance: distance }
    );

    if (obstruction && obstruction.distance < distance - 0.35) {
      this.decals.spawn(obstruction, { size: 0.08, spark: true });
      this._spawnTracer(_shotStart, obstruction.point, 0xff7d55);
      this.audio?.play?.('shot');
      return;
    }

    this._spawnTracer(_shotStart, _shotEnd, 0xff4f3f);
    this.audio?.play?.('shot');
    this.bus?.emit?.('player:damaged', {
      damage: 7,
      source: enemy.root,
      point: _shotEnd.clone(),
    });
  }

  _spawnTracer(start, end, color) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start.clone(), end.clone()]);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.userData.isCombatVfx = true;
    line.userData.combatIgnore = true;
    this.scene.add(line);
    this.tracers.push({ line, age: 0, ttl: 0.08 });
  }

  _updateTracers(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.age += dt;
      const life = 1 - tracer.age / tracer.ttl;
      if (life <= 0) {
        this.scene.remove(tracer.line);
        tracer.line.geometry.dispose();
        tracer.line.material.dispose();
        this.tracers.splice(i, 1);
      } else {
        tracer.line.material.opacity = 0.7 * life;
      }
    }
  }
}
