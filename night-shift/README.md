# NIGHT SHIFT

NIGHT SHIFT is a first-person stealth/combat vertical slice about two contractors sharing one attention budget. Whoever holds attention is visible and hunted; whoever sheds it becomes ghostlike enough to cross exposed space.

## Design pillars

- Shared attention: stealth is a trade between your visibility and your partner's ghost window.
- Light as map: darkness, broken fixtures, and sightlines define safe routes.
- Hard-cut loud: getting spotted turns the slice into close-quarters survival instead of a fail state.
- Contract pressure: shots, damage, and time erode the payout.

## Run locally

```sh
npm install
npm run dev
```

Open the Vite URL in a WebGL-capable browser and choose **Accept Contract** to lock pointer input and start the shift.

## Controls

- WASD: move
- Mouse: look
- Shift: walk
- Control: crouch
- F: throw a distraction
- 1: pull/hold attention on you
- 2: release attention to the partner
- Right mouse: aim down sights
- Left mouse: fire
- R: reload
- Q: melee
- Escape: release pointer lock

## Vertical slice contents

- One playable room built around patrol routes, lighting, and cover.
- Shared attention meter with player/partner visibility tradeoffs.
- Partner ghost presence for stealth windows.
- Guard perception, suspicion, hearing, patrol, chase, and combat escalation.
- Loud-mode reinforcements and weapon handling.
- Contract invoice HUD tracking stealth value, ammo, damage, and hazard pay.

## Technical systems

- Three.js renderer with fixed 60 Hz gameplay pacing via `FrameLock`.
- Event-bus orchestration between attention, mode, economy, weapon, guard, and HUD systems.
- Procedural audio unlock and lightweight sound effects.
- Post-processing pass for visibility and mode feedback.
- WebGL boot guard with retryable pointer-lock start flow.
