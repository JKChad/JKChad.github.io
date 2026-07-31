import { DEFAULT_LEVEL_ID } from './index.js';
import { LevelManager } from './LevelManager.js';

function removeFromScene(scene, object) {
  if (object?.parent) object.parent.remove(object);
  else if (object) scene?.remove?.(object);
}

function applySpawn(game, level) {
  const p0 = level.spawn?.p0;
  if (p0 && game.player?.position) {
    game.player.position.set(p0.x ?? 0, p0.y ?? 0, p0.z ?? 0);
    if (Number.isFinite(p0.yaw)) game.player.yaw = p0.yaw;
    game.player._syncCamera?.();
  }

  const p1 = level.spawn?.p1;
  if (p1 && game.partner?.mesh?.position) {
    game.partner.mesh.position.set(p1.x ?? 0, p1.y ?? 0, p1.z ?? 0);
  } else if (p1 && game.partner?.position) {
    game.partner.position.set(p1.x ?? 0, p1.y ?? 0, p1.z ?? 0);
  }
}

function applyGuardPatrol(game, manager) {
  const patrol = manager.getPatrols()[0] ?? [];
  if (patrol.length === 0 || !game.guard) return;

  game.guard.patrol?.setPath?.(patrol);
  game.guard.position?.copy?.(patrol[0]);
  if (game.guard.patrol) game.guard.patrol.index = patrol.length > 1 ? 1 : 0;
  if (patrol[1]) game.guard._turnImmediatelyToward?.(patrol[1]);
}

export function installLevels(game, options = {}) {
  if (!game?.scene) {
    throw new TypeError('installLevels(game) requires a NIGHT SHIFT Game instance.');
  }

  const levelId = options.levelId ?? DEFAULT_LEVEL_ID;
  const manager = options.manager ?? new LevelManager(game.scene, game.bus, options.lightsSystemFactory);
  const previousRoom = game.room;
  const previousLights = game.lights;

  manager.load(levelId);
  const level = manager.getCurrent();

  if (previousRoom !== manager) removeFromScene(game.scene, previousRoom?.group);
  if (previousLights !== manager.lights) {
    removeFromScene(game.scene, previousLights?.group);
    removeFromScene(game.scene, previousLights?.ambient);
  }

  game.levelManager = manager;
  game.room = manager;
  game.lights = manager.lights;

  if (game.objective) {
    game.objective.extracted = false;
    game.objective.extractPos = manager.getExtract();
    game.objective.extractRadius = options.extractRadius ?? game.objective.extractRadius ?? 2.2;
  }

  applySpawn(game, level);
  applyGuardPatrol(game, manager);

  if (game.perception) {
    game.perception.lights = manager.lights;
    game.perception._occluderSource = null;
    game.perception._occluderSourceLength = -1;
    game.perception._cachedOccluders = null;
  }

  if (game.combat) {
    game.combat.lights = manager.lights;
    if (game.combat.breakableLights) game.combat.breakableLights.lights = manager.lights;
    game.combat.hitscan?.invalidateCandidates?.();
  }

  if (options.applyAlarmOnLoud !== false) {
    game.bus?.on?.('mode:loud', () => manager.applyAlarmLayout());
  }

  game.bus?.emit?.('level:loaded', { levelId: level.id, level, manager });
  return manager;
}
