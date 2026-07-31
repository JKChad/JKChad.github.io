import { CONFIG, KEYS } from '../config.js';
import { AttentionModel } from '../core/attention/AttentionModel.js';
import { NetGameBridge } from './NetGameBridge.js';
import { NetLobby } from '../ui/NetLobby.js';

function keyAxis(keys, positive, negative) {
  return (keys?.has?.(positive) ? 1 : 0) - (keys?.has?.(negative) ? 1 : 0);
}

function applyMappedAttention(game, snap, localSeat) {
  if (!snap || typeof snap.p0 !== 'number') return;
  const local = localSeat === 0 ? snap.p0 : snap.p1;
  const partner = localSeat === 0 ? snap.p1 : snap.p0;
  if (Math.abs((game.attention.p1 ?? 0) - local) < 0.001 && Math.abs((game.attention.p2 ?? 0) - partner) < 0.001) {
    return;
  }
  game.attention.p1 = local;
  game.attention.p2 = partner;
  game.bus.emit('attention:changed', { p1: local, p2: partner });
}

function createInputRouter(game, bridge) {
  let seq = 0;
  return {
    seat() {
      return {
        toNet() {
          const inputSeat = game.input?.getSeat?.(0);
          const netFrame = inputSeat?.toNet?.();
          if (netFrame) {
            return {
              ...netFrame,
              s: bridge.localSeat,
            };
          }

          const keys = game.player?._keys;
          const weapon = game.weapon;
          const holdAttention = keys?.has?.(KEYS.holdAttention);
          const releaseAttention = keys?.has?.(KEYS.releaseAttention);
          const walk = keys?.has?.(KEYS.walk);
          const crouch = keys?.has?.(KEYS.crouch);
          const b =
            (walk ? 1 : 0) |
            (crouch ? 2 : 0) |
            (weapon?._triggerHeld ? 4 : 0) |
            (weapon?.isAds ? 8 : 0) |
            (weapon?.reloading ? 16 : 0) |
            (keys?.has?.(KEYS.distract) ? 32 : 0) |
            (keys?.has?.(KEYS.melee) ? 64 : 0) |
            (holdAttention ? 128 : 0) |
            (releaseAttention ? 256 : 0);
          return {
            s: bridge.localSeat,
            seq: ++seq,
            mx: keyAxis(keys, KEYS.right, KEYS.left),
            my: keyAxis(keys, KEYS.forward, KEYS.back),
            lx: 0,
            ly: 0,
            b,
            walk,
            crouch,
          };
        },
      };
    },
  };
}

function localState(game, seq = 0) {
  const player = game.player;
  return {
    x: player?.position?.x ?? 0,
    y: player?.position?.y ?? 0,
    z: player?.position?.z ?? 0,
    yaw: player?.yaw ?? 0,
    pitch: player?.pitch ?? 0,
    vx: player?.velocity?.x ?? 0,
    vz: player?.velocity?.z ?? 0,
    seq,
  };
}

function applyStateToGame(game, seat, state, { local = false } = {}) {
  if (!state) return;
  if (local) {
    const player = game.player;
    if (!player) return;
    player.position.x = state.x ?? player.position.x;
    player.position.y = state.y ?? player.position.y;
    player.position.z = state.z ?? player.position.z;
    player.yaw = state.yaw ?? player.yaw;
    player.pitch = state.pitch ?? player.pitch;
    if (player.velocity) {
      player.velocity.x = state.vx ?? player.velocity.x;
      player.velocity.z = state.vz ?? player.velocity.z;
    }
    player._syncCamera?.();
    return;
  }

  const partner = game.partner;
  if (!partner?.position) return;
  partner.position.x = state.x ?? partner.position.x;
  partner.position.y = state.y ?? partner.position.y;
  partner.position.z = state.z ?? partner.position.z;
  if (partner.group?.rotation && Number.isFinite(state.yaw)) partner.group.rotation.y = state.yaw;
}

function seedAttentionModel(model, game, localSeat) {
  const local = game.attention?.p1 ?? CONFIG.attention.total * 0.5;
  const partner = game.attention?.p2 ?? CONFIG.attention.total - local;
  model.shares.p0 = localSeat === 0 ? local : partner;
  model.shares.p1 = CONFIG.attention.total - model.shares.p0;
  model.revision = 0;
  model.setTransferIntent(0, 0, { authority: true });
  model.setTransferIntent(1, 0, { authority: true });
}

export function installNet(game, uiRoot = document.getElementById('ui')) {
  const attentionModel = new AttentionModel({
    total: CONFIG.attention.total,
    transferRate: CONFIG.attention.transferRate,
  });

  const bridge = new NetGameBridge({
    bus: game.bus,
    attention: attentionModel,
    inputRouter: null,
    getLocalState: () => localState(game),
    applyRemoteState: (seat, state, options) => applyStateToGame(game, seat, state, options),
    applyAttention: (snap, { localSeat }) => applyMappedAttention(game, snap, localSeat),
  });
  bridge.inputRouter = createInputRouter(game, bridge);

  const originalHost = bridge.host.bind(bridge);
  const originalJoin = bridge.join.bind(bridge);
  bridge.host = async () => {
    seedAttentionModel(attentionModel, game, 0);
    return originalHost();
  };
  bridge.join = async (roomId) => {
    seedAttentionModel(attentionModel, game, 1);
    return originalJoin(roomId);
  };

  const attention = game.attention;
  const originalAttention = {
    update: attention.update?.bind(attention),
    setTransfer: attention.setTransfer?.bind(attention),
    spikeLocal: attention.spikeLocal?.bind(attention),
    spikePartner: attention.spikePartner?.bind(attention),
  };

  attention.update = (dt) => {
    if (bridge.active) return;
    originalAttention.update?.(dt);
  };
  attention.setTransfer = (dir) => {
    if (bridge.active) {
      bridge.setAttentionTransfer(dir);
      return;
    }
    originalAttention.setTransfer?.(dir);
  };
  attention.spikeLocal = (amount) => {
    if (bridge.active) {
      bridge.sendAttentionSpike(amount, bridge.localSeat);
      return;
    }
    originalAttention.spikeLocal?.(amount);
  };
  attention.spikePartner = (amount) => {
    if (bridge.active) {
      bridge.sendAttentionSpike(amount, bridge.remoteSeat);
      return;
    }
    originalAttention.spikePartner?.(amount);
  };

  const originalSimulate = game._simulate.bind(game);
  game._simulate = (dt) => {
    originalSimulate(dt);
    bridge.update(dt);
  };

  const lobby = new NetLobby({ root: uiRoot, bus: game.bus, bridge });
  globalThis.__nightShiftNet = { bridge, lobby };

  return {
    bridge,
    lobby,
    dispose() {
      game._simulate = originalSimulate;
      Object.assign(attention, originalAttention);
      lobby.dispose();
      bridge.dispose();
      if (globalThis.__nightShiftNet?.bridge === bridge) delete globalThis.__nightShiftNet;
    },
  };
}
