# NIGHT SHIFT

First-person co-op stealth-action. Stealth is a conversation: a shared attention meter always sums to 100%. Light is the map. Getting spotted hard-cuts to loud CQB — you can fight out, but the invoice will notice.

## Run

```bash
npm install
npm run dev
```

Open the Vite URL → **Accept Contract**.

### Levels

| Query | Level |
|---|---|
| `?level=level01_archives` (default) | Vertical atrium archives |
| `?level=level02_substation` | Alarm flips layout/lights |
| `?level=level03_loading_bay` | Wide loading bay / catwalks |

### Netplay (host-authoritative WebRTC)

Use the lobby panel: **Host** copies a room code, partner **Join**s. Attention is host-authoritative. Movement is client-predicted and reconciled. Peer leave continues solo.

Latency sim: `?netTest=1` (150ms + loss).

### Controls (Seat 0)

- WASD move · Mouse look · Shift walk · Ctrl crouch
- LMB fire · RMB ADS · R reload · Q melee
- F distract · 1/2 trade attention
- G gadget · X cycle gadget · C/V weapon swap
- E hide body (near corpse)

Seat 1 (local hotseat / pad): arrows + numpad (see `src/input/bindings.js`). Gamepad 0/1 map to seats.

## Design pillars

1. **Attention conversation** — make noise to buy your partner a ghost window
2. **Light-as-map** — break bulbs, kill volumetric pools, traverse shadow
3. **Genre hard-cut** — no stealth soft-fail restart; fight or regroup
4. **Economy-as-difficulty** — itemized invoice; Silence/Muscle/Tech/Nerve stats; drone modules

## Architecture

Engine-agnostic core under `src/core/` (attention, alert, economy, input seats, net session, partner brain). Three.js stays in presentation adapters. This build is portable toward a native console engine.

## Scripts

```bash
npm run build
npm run smoke              # headless boot + loud transition
npm run test:visual        # screenshot-diff light pools
npm run test:visual:update # refresh baselines
node src/core/net/netTest.mjs
```

## Systems

- Dual-seat input abstraction (keyboard + gamepad + remote)
- Host-authoritative PeerJS netplay
- Guard AlertBrain tiers + body hide/propagate
- Weapons (SMG/Pistol/Shotgun/DMR) + Flashbang/EMP/Taser
- Enemy types: rusher / shield / tech / sniper
- Regroup loop when blown
- Procedural spatial audio + tension music
- 60Hz FrameLock + adaptive PerfBudget
- Visual regression on fixed cameras
