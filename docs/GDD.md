# [WORKING TITLE] — FRIENDSLOP

**Game Design Document — Slice First**
Version 0.4 · Target: playable 25-minute site, not a galaxy

**Title status:** *Dominion* is retired (StarCraft faction name, Blizzard C&D history, and a registered games trademark for the card game). Shortlist that steps on neither: **KEEL**, **WARDEN SITE**, **COMPACT**, **ON THE LINE**, **FOOTPRINT**, **SCRAP AND SUPPLY**. Pick an ugly short word. Press may say StarCraft. We never do. FriendSlop stays as studio name or subtitle only if we can live with it on a store page.
Changelog 0.2: pre-graybox closures folded in (§17 and the lines they touch).
Changelog 0.3: art direction locked (§18); §14 marketing line reconciled to it.
Changelog 0.4: title retired; army cap set; production posture rewritten for a solo budget (§15).
Changelog 0.5: phase 0 is a 2D GameMaker prototype of the trade (§15). Third person is deferred to the 3D port.

-----

## 1. One sentence

You are the strongest unit on a live RTS map, and every second you spend commanding is a second you are not on the wall.

-----

## 2. What this is / is not

**Is:** A third-person commander action game with a real economy and a real army on one hostile landing site at a time.

**Is not:** Starfield. Not a live-service planet. Not *Helldivers*. Not *Space Marine 2*. Not Blizzard's 2030 shooter. Not a pause-and-plan RTS with a skin.

The joke in the title is the marketing. The verb in the sentence is the game.

-----

## 3. Pillars (in order)

1. **The trade hurts.** Command view costs your body. Ground view costs your economy.
2. **Both halves can win.** Quiet hero run and loud factory run are both valid. Indecision is the fail state.
3. **Buildings are placed with feet.** If you can drop a barracks from the sky like a god, the design has already collapsed.
4. **Counters are sharp.** Wrong roster loses. Hero cannot delete the swarm. Army cannot crack the breach.
5. **One site, then extract.** 25–45 minutes. No mid-mission reload. You leave with what you carried.

-----

## 4. Fantasy

Cheap human empire. You are not a chosen one. You are the officer who walked out of the drop-pod because the last officer died. Radio propaganda loves you until you fail. The planet does not.

Visual: industrial, muddy, fluorescent interiors, torn flags, armor that looks maintained by a quartermaster who hates you. Full art direction in §18.

IP: original nouns. No hydralisks, no CMC, no Dominion as Blizzard spells it. Steal the *feeling*.

Working names (replace later):

| Role                   | Name      |
|------------------------|-----------|
| Player faction         | Compact   |
| Swarm pressure faction | Broodveil |
| Elite / breach faction | Choir     |
| Player title           | Warden    |
| Drop HQ                | Keel      |

-----

## 5. Camera and control

**Default:** third person, over-the-shoulder, Warden on foot. *(3D target. The GameMaker prototype in §15 uses a tight top-down ground camera instead. The pillar is presence, not the angle.)*

**Command overlay:** hold a shoulder button. Camera lifts to a top-down tactical view *centered on you*. World time runs at **50%**. Not paused. Not 10%. Fifty.

**Site map:** tap for a static strategic view of the whole landing. Time still at 50% if a wave is live. Full pause exists only on the lowest difficulty.

**Ground orders (radial, 4 slots + implicit move):**

- Hold
- Follow
- Focus target
- Fall back (to the last flare; no flare this site → to Core)

That is the entire hip language. Fine control (waypoints, production queues, rally) lives in overlay.

**Building:** walk to a valid pad, hold interact, ghost appears, confirm. Cancel by walking off. No god-click construction.

**Overlay budget:** overlay up in **≤150 ms**. First order (produce, rally, or group) issuable within **1.0 s** of the button.

**Hard rule:** if testers cannot switch views without thinking, or the overlay budget is missed in playtest, stop adding systems until it hits.

-----

## 6. The two halves

### Warden (you)

By far the strongest single unit. Melee and close guns. Four abilities in the slice (see §12).

**Commander-only problems:**

- Breach doors / shield nests
- Site bosses
- Extract beacon (must be stood on)

If a mass of troops can solve these, cut that solution.

### Army

Does the work you cannot be present for. Second lanes, chokepoints, harvesting escort, chip damage.

**Army-only problems:**

- Swarm waves
- Multi-vector pressure
- Holding a pad while you are elsewhere

If the Warden can stand in one place and win the site, the army is wallpaper. Fix counters before adding units.

**Army cap:** 20–40 units on screen. *They Are Billions* small, not *StarCraft*. Basic engine agents are enough at this count; no crowd stack required.

-----

## 7. Economy (slice)

Three numbers only.

| Resource | Comes from                        | Sinks                           |
|----------|-----------------------------------|---------------------------------|
| Scrap    | nodes + salvage                   | buildings, unit production      |
| Power    | tap-lines you walk out and plant  | building upkeep, advanced units |
| Supply   | bunks / hab                       | unit cap                        |

Harvest is not automatic from orbit. A node is a thing on the ground. An extractor is a building you walked to. If you abandon it, Broodveil takes it back.

Production queues run while you are on the line. That is the point.

-----

## 8. Threat

Threat is a single visible meter.

**Rises with:** base footprint, power draw, gunfire noise, mission clock.

**Falls with:** destroyed nests, quiet periods, pulling buildings down.

**Floor:** demolished footprint keeps its threat contribution for **60 seconds**. Decay is a delayed slope, not an instant refund. You cannot dismantle your way out of a wave you already paid for.

High threat = more vectors, denser swarms, Choir elites mixed in.
Low threat + small base = Space Marine-shaped run.
High threat + wide base = StarCraft-shaped run with you as the hero unit.

The game does not score which style you picked. It scores whether you committed.

-----

## 9. Mission shape

One landing.

1. Drop. Keel is a small prefab: core, one bay, one pad.
2. Scout on foot. Find scrap, a nest, a breach.
3. Commit: quiet kill-the-nests, or loud expand.
4. Objective (one per slice mission): hold two relays **or** crack the hive **or** reach Tech 2 and extract.
5. Extract: stand the beacon. Army can die. If the Warden dies, site failed. Retreat to orbit with inventory on the body only.

**Core loss:** ends production and all queued units. Existing army stays. Site is not auto-failed. Extract remains possible on foot. Warden death = fail. Core death = cripple, not fail.

No checkpoint in the middle. Die or leave.

Length target: **25 minutes** for the slice. 45 is the cap after the slice works.

-----

## 10. Factions on the site (slice)

**Broodveil** — volume, pathing, creep that slows buildings and heals their packs. Army shines.

**Choir** — few, armored, shield bubbles, breach elites. Warden shines.

Mixed spawn only after each faction is readable alone. First playable: Broodveil only.

-----

## 11. Progression (after the slice, not in it)

Do not build this until the switch is fun.

- **Warden tree:** Warrior / Marshal / Engineer. One branch per run if needed.
- **Doctrine:** roster, not a story choice. Reputation unlocks units.
- **Keel:** ship loadout changes the drop prefab (extra bay, pre-placed turret, extra scrap).

Galaxy is a mission select with flavor. It is not a second game.

-----

## 12. Vertical slice — freeze list

Ship this or ship nothing.

**Warden**

- Move, sprint, melee, one gun
- Abilities (4): slam, grapple-to-owned-pad, banner (small army buff aura), flare (rally primitive; Fall back goes here)

**Buildings (5)**

- Core (already dropped)
- Extractor
- Bay (produces two unit types)
- Bunk (supply)
- Turret

**Units (4, capped at 20–40 on screen)**

- Levy (cheap chaff)
- Pike (anti-swarm cone)
- Maul (anti-elite, slow)
- Drone (repair only + finish Warden-confirmed ghosts, no combat)

**Site**

- One canyon-and-creep map
- Two scrap nodes, one power tap, one nest, one breach door, one extract ridge
- Broodveil only
- One objective: destroy the nest, then extract

**UI**

- Scrap / power / supply
- Threat meter
- Radial
- Overlay production bar

**Explicitly out of slice:** second faction, doctrines, skill tree, ship meta, co-op, story, pause-on-wave, more than one gun, crowd-scale unit counts, a Steam page, a counter-trailer.

**Pass metric:** testers switch views at least a few times per minute without being told, and can point to the minute they lost.

-----

## 13. Failure vocabulary

Players should be able to say one of these:

- "I was on the breach and the second lane walked into the core."
- "I stayed in overlay and the elite ate me."
- "I built too wide and threat drowned the pads."
- "I stayed quiet too long and the clock called the Choir." (post-slice)
- "The core died and I had to walk the beacon out."
- "I died and the army did not get to finish it."

If they say "I didn't know what to press," the control layer failed, not the player.

-----

## 14. Tone and presentation

Marketing can stay FriendSlop: helmet renders in the §18 cheap-cabin style, 2030 energy, "early in development," waitlist. Any render that looks like the BlizzCon 2026 teaser is rejected (§18).

The build cannot. No seasonal pass on the slice. No empty open world. No cinematic that the game cannot play.

Voice: quartermaster radio, not chosen-one narration.

-----

## 15. Production posture

This is an experiment run by one person on nights and weekends until the switch is proven fun. It is not a studio.

AI is for meshes, graybox, boilerplate, VO scratch, stills. AI does not sit in a design chair.

The human owns: camera feel, radial latency, pathing at the wall you just built, and the week you delete a system because the trade stopped hurting.

Order of work: a third-person controller you can already ship, then the overlay, then units colliding with a wall you placed, then buildings. Do not start buildings before the controller. Do not start the galaxy. Start the canyon.

Engine: the one you already know. That is GameMaker, so phase 0 is a **2D top-down prototype in GameMaker**. It tests the only thing that matters: does commanding cost your body, and does fighting cost your economy. Every pillar in §3 survives in 2D. Only the camera angle in §5 does not, and the camera angle is not a pillar.

**GameMaker prototype scope (phase 0, 4–8 weeks of nights):**

- Ground view: tight top-down camera locked to the Warden, twin-stick or mouse-aim, melee plus one gun.
- Overlay: hold a key, camera zooms out to the site, game speed 50%, click-drag select and right-click orders. Release to drop back.
- Radial: four ground orders on a held key.
- Walk-to-build: pads on a grid, stand on one, hold to confirm a ghost.
- 20–40 units as simple agents. Grid pathing (mp_grid) around placed buildings.
- One nest, waves on a threat meter, one extract pad.
- Art: colored rectangles and circles with one icon each. Nothing else until the switch works.

If the switch is fun as rectangles, it will be fun in 3D. If it is not fun as rectangles, no engine fixes it.

**After the prototype passes:** port to **Godot 4**. It is free, its scene-and-node model is the closest thing to GameMaker's objects-and-rooms, GDScript reads like GML with Python spelling, and 3D at 20–40 units is well within it. Unreal is a stage-two decision if a team appears. Do not start the port before the prototype passes its gate.

If the experiment is good, the studio conversation happens with someone else's money. If it is bad, you spent evenings, not a house.

-----

## 16. Title, still

**[WORKING TITLE]: FRIENDSLOP**

See the title status at the top. If the slice is good, the subtitle becomes a scar. If the slice is bad, the subtitle was honest.

-----

## 17. Closures (pre-graybox)

**Grapple-to-pad.** Grapple is legal only onto a pad the Compact already owns (Core, built building, or claimed relay). It is a reposition across *your* footprint, not a teleport to a ghost. If that still makes walking cheap, cut grapple from the slice. Placement cost stays on foot.

**Drone.** Drone repairs and escorts. It does not start buildings. A ghost exists only after the Warden confirms it by standing on the pad. Drone may finish a confirmed ghost if the Warden leaves. That is assist, not god-click.

**Fall back.** Fall back destination is the last flare. No flare this site → fall back to Core. Flare is the only hip rally primitive. Overlay can still set per-group rallies.

**Overlay budget.** Overlay must be up in **≤150 ms**. First order (produce, rally, or group) must be issuable within **1.0 s** of the button. Miss either number in playtest and you stop adding systems until it hits.

**Threat floor.** Demolished footprint keeps its threat contribution for **60 seconds**. Decay is a delayed slope, not an instant refund. Cheese is pulling the base down *during* the delay while the wave is already paid for.

**Core stake.** Core loss ends production and all queued units. Existing army stays. Site is not auto-failed. Extract remains possible on foot. Warden death still fails the site. Two failure sentences testers can use:

- "The core died and I had to walk the beacon out."
- "I died and the army did not get to finish it."

This is the week-one graybox spec. §12 remains the freeze list; §17 constrains how those items behave.

-----

## 18. Art direction (locked)

The reference is not Flight Simulator. It is the cheap-cabin look: *Uh Oh Airlines*, *Dear Passengers*, *Lethal Company*, *R.E.P.O.* Readable toys under bad fluorescent lights. Silhouettes you can parse from overlay. Physics that can be funny without the systems being funny. That is what "FriendSlop" already promised on the box.

**Rules**

- **Camera distance wins.** Overlay must read a Levy from a Maul at a glance. Big heads, big guns, big pads, no grit soup.
- **Materials are institutional.** Scratched plastic, painted steel, wet mud, yellow safety stripes. One accent color per faction: Compact amber, Broodveil violet, Choir cold white. Not PBR hero shots.
- **Warden is a mascot in armor**, not a photogrammetry operator. If the helmet does not read as an icon at 64 pixels, the overlay is dead.
- **Animation can be a little wrong.** Landings that thump. Buildings that unfold like airport stairs. Swarm that is too many legs. Comedy is in the body, not the writing.
- **Blood and scale stay real.** Waves should still scare. Silly materials, serious numbers. *TABS* with stakes, not *TABS*.

**The one upgrade worth paying for**

Keep the toy-like characters and buildings. Spend the extra fidelity on **space and weather**: canyon scale, rain, creep that looks like it grew on the map, drop-pod lighting. World grim. Units slightly stupid-looking. That split avoids both "AI slop cinematic" and "this is a party game."

**Slice palette**

| Thing       | Look                                                          |
|-------------|---------------------------------------------------------------|
| Warden      | Amber visor, dented cheap plate, backpack radio               |
| Levy        | Hardhat army                                                  |
| Pike / Maul | Same suit family, weapon is the silhouette                    |
| Broodveil   | Wet purple mass, too many joints                              |
| Buildings   | Site-office architecture, cones, floodlights                  |
| Keel drop   | Budget airliner bones: ribbed hull, bad seats, cargo rollers  |

**Rule for AI art**

Generate helmets and stills in this style on purpose. If a render looks like the BlizzCon 2026 teaser, reject it. That look is the thing being mocked and the thing that cannot be afforded in animation.

Silly enough to ship with generated meshes. Heavy enough that losing the core still feels like a crash, not a punchline.
