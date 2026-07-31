# NIGHT SHIFT

NIGHT SHIFT is a first-person stealth/combat vertical slice about two contractors sharing one attention budget. Whoever holds attention is visible and hunted; whoever sheds it becomes ghostlike enough to cross exposed space and work the dark. Get through the room and extract at the far door.

## Design pillars

- **Attention conversation:** stealth is negotiated moment to moment. Pull heat onto yourself to open a ghost window for the partner, or release attention when your route is getting burned.
- **Light-as-map:** darkness, broken fixtures, emergency spill, and guard sightlines define the readable safe routes.
- **Genre hard-cut:** getting spotted is not a fail state; it snaps the slice from stealth into close-quarters survival.
- **Economy-as-difficulty:** every shot, broken light, loud second, and damage event eats into the contract, so survival and payout are the same pressure.

## Run locally

```sh
npm install
npm run dev
```

Open the Vite URL in a WebGL-capable browser and choose **Accept Contract** to lock pointer input and start the shift.

For a production check:

```sh
npm run build
```

## Controls

- **WASD:** move
- **Mouse:** look
- **Shift:** walk
- **Control:** crouch
- **F:** throw a distraction
- **1:** hold/pull attention onto you
- **2:** release attention to the partner
- **Right mouse:** aim down sights
- **Left mouse:** fire
- **R:** reload
- **Q:** melee
- **Escape:** release pointer lock
- **Extraction:** reach the far door; no key press required.

## Systems list

- Shared attention ledger with player heat, partner ghost-window readout, suspicion copy space, and extract prompt API.
- Partner ghost presence driven by attention transfer.
- One playable room built around patrol routes, lighting, cover, and a far-door extraction point.
- Guard perception with light sampling, line of sight, suspicion, hearing, investigation, chase, and combat escalation.
- Hard-cut loud mode with alarm state, reinforcements, weapon handling, melee, reloads, and ADS.
- Contract invoice economy tracking base pay, stealth bonus, ammunition costs, property damage, loud entry, and hazard pay over time.
- Three.js renderer with fixed 60 Hz gameplay pacing via `FrameLock`.
- Event-bus orchestration between attention, mode, economy, weapon, guard, combat, audio, post-processing, and HUD systems.
- Procedural audio unlock and lightweight sound effects for alarms, distractions, shots, reloads, and impacts.
- Post-processing feedback for visibility, loud mode, film grain, and performance state.
- WebGL boot guard with retryable pointer-lock start flow.
