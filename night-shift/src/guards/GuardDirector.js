import { GuardNetwork } from '../core/alert/AlertBrain.js';
import { Guard } from './Guard.js';
import { PerceptionSystem } from './PerceptionSystem.js';
import { BodySystem } from './BodySystem.js';

/**
 * Presentation-side owner for guard AI.
 * Keeps the engine-agnostic GuardNetwork centralized while guards remain
 * Three.js actors that can still be constructed directly by older code.
 */
export class GuardDirector {
  constructor(scene, bus, options = {}) {
    this.scene = scene;
    this.bus = bus;
    this.lights = options.lights ?? null;
    this.attention = options.attention ?? null;
    this.modes = options.modes ?? null;
    this.room = options.room ?? null;
    this.guardClass = options.guardClass ?? Guard;
    this.guards = [];

    this.network = options.network ?? new GuardNetwork(bus);
    this.bodySystem = options.bodySystem ?? new BodySystem(scene, bus, options.bodyOptions);
    this.perception =
      options.perception ??
      new PerceptionSystem(scene, bus, this.lights, this.attention, this.modes, {
        bodySystem: this.bodySystem,
      });

    for (const guard of options.guards ?? []) this.registerGuard(guard, options);
    if (options.autoSpawn) this.spawnGuard(options.autoSpawn === true ? {} : options.autoSpawn);
  }

  spawnGuard(options = {}) {
    const patrolPath = options.patrolPath ?? this._patrolPathFor(options.index ?? this.guards.length);
    const guard = new this.guardClass(this.scene, this.bus, patrolPath, {
      id: options.id,
      brain: options.brain,
      networkManaged: true,
    });
    if (options.position) guard.position.copy(options.position);
    return this.registerGuard(guard, options);
  }

  registerGuard(guard, options = {}) {
    if (!guard || this.guards.includes(guard)) return guard;
    guard.networkManaged = true;
    this.guards.push(guard);
    if (guard.brain) this.network.register(guard.brain);
    options.combat?.registerEnemy?.(guard.mesh);
    this.bus?.emit?.('guard:registered', { guard, director: this });
    return guard;
  }

  unregisterGuard(guard) {
    const index = this.guards.indexOf(guard);
    if (index >= 0) this.guards.splice(index, 1);
    if (guard?.brain) this.network.unregister(guard.brain.id);
    this.bus?.emit?.('guard:unregistered', { guard, director: this });
  }

  update(dt, player, partner, mode = this.modes?.mode, combat = null, options = {}) {
    const active = this.guards.filter((guard) => guard?.alive && guard.state !== 'dead');
    this.perception?.update?.(dt, player, partner, active, { seat: options.seat });
    this.network.update(dt);

    for (const guard of this.guards) {
      guard.update(dt, player, mode, combat);
    }
  }

  hear(pos, kind = 'noise') {
    for (const guard of this.guards) guard.hearNoise?.(pos, kind);
  }

  livingGuards() {
    return this.guards.filter((guard) => guard?.alive && guard.state !== 'dead');
  }

  _patrolPathFor(index) {
    const paths = this.room?.patrolPaths ?? null;
    if (Array.isArray(paths) && paths.length > 0) return paths[index % paths.length];
    return this.room?.patrolPath;
  }
}
