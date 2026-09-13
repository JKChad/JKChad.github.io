# DOMINION: FRIENDSLOP — Feasibility and Timeline

Version 0.1 · 2026-09-13 · Companion to `DOMINION-FRIENDSLOP-GDD.md`

-----

## 1. Verdict

Feasible, with two conditions.

1. The slice in GDD §12/§17 ships first and gates everything else. FPS/RTS hybrids built by one person have historically taken about five years (Silica, Executive Assault 2). The only way to beat that is the freeze list.
2. The title changes before the Steam page goes up. "Dominion" is a StarCraft faction name and Blizzard sends cease-and-desists. The joke survives in the subtitle and the marketing voice.

Recommended shape: a three-person core, Unreal Engine 5, Steam page inside 30 days, public demo at Steam Next Fest June 2027, Early Access in the first half of 2028, 1.0 in 2029. That lands the full game before Blizzard's Spring 2030 date, which is the whole bit.

-----

## 2. The window

**What Blizzard announced (BlizzCon, 12 Sep 2026):** an open-world, story-driven sci-fi shooter titled STARCRAFT, set 70 years after Legacy of the Void, led by Dan Hay (Far Cry 5). Target Spring 2030. Cinematic trailer only, no gameplay, no platforms, described as early in development.

**What that means for us:**

- The momentum is a news cycle, not a product. It peaks this week and again each BlizzCon when they show more. There is no gameplay to be compared against yet, so a fast, honest playable is the strongest counter-programming.
- The 2030 date gives a clear finish line. "Ours ships first" is a marketing line we can actually earn.
- Their game is a shooter. Ours is an action-RTS with an economy. The pitch writes itself: "They took the RTS out of StarCraft. We put the commander back on the ground."

**Capture points, in order:**

| When | Beat | Asset needed |
|---|---|---|
| Within 2 weeks | Steam page + 30-second teaser | Helmet render, logo, three graybox shots, name locked |
| Feb 2027 Next Fest | Optional. Only if the slice already passes its own gate. | Rough demo of the canyon |
| June 2027 Next Fest | Primary demo beat | Polished 25-minute slice |
| BlizzCon 2027 (likely Sep/Oct) | Counter-trailer with real gameplay the week they show theirs | EA-quality build |
| H1 2028 | Early Access launch | 2 factions, 4–6 sites, doctrine roster |
| 2029 | 1.0 | Galaxy mission select, Warden tree, Keel loadouts |

Each event has a registration deadline months ahead. Next Fest requires a Coming Soon page and a demo build by the deadline, and a game can only enter Next Fest once.

-----

## 3. Comparables

| Game | Team | Time to Early Access | Notes |
|---|---|---|---|
| Silica (Bohemia Incubator) | Mostly one developer, plus environment and UI help | Started 2018, EA May 2023 (5 yrs), planned ~1 yr EA | Closest design comparable: RTS/FPS hybrid, sci-fi, hostile planet |
| Executive Assault 2 | Solo (Rob Hesketh) | EA Oct 2018, 1.0 Oct 2023 (5 yrs in EA) | Solo hybrids run long. Scope creep in EA is the pattern |
| Yacht Club Games (Shovel Knight, reference for a disciplined small team) | Small professional team | ~15 months from campaign to ship | Shows what a defined scope buys |

Takeaway: hybrid genre, solo developer, open scope is a five-year project with no market beat. Hybrid genre, three people, frozen slice is a 2.5-year project that can hit June 2027 and H1 2028.

-----

## 4. Engine

**Recommendation: Unreal Engine 5.**

Reasons:

- Mass Entity (ECS) is built in. Community frameworks show 250 skeletal-mesh units plus 600+ instanced meshes at 60 fps, with multiplayer and Gameplay Ability System already wired. The slice needs a few dozen units. Early Access needs maybe 150 on screen. That is comfortably inside the envelope.
- The marketing joke depends on the "2030 helmet render" look. Unreal produces that look with the least art spend.
- Third-person character movement, animation, and camera are the most mature out of the box, and camera feel is one of the human-owned items in GDD §15.

Costs to accept:

- Contractor rates run 30–50% above Unity equivalents.
- Compile and iteration time is slower. Mitigate with Blueprint for gameplay scripting in the slice and C++ only for the Mass and pathing layer.
- Needs a strong dev PC per seat.

Alternatives:

- **Unity** with DOTS/ECS is viable and cheaper to staff. Choose it if the team is already Unity-native. It will not produce the helmet render on the same budget.
- **Godot 4** is not recommended here. 3D and large-unit-count tooling still trail, and the asset ecosystem for third-person action is thin.

-----

## 5. Team and cost scenarios

Salary ranges from 2026 indie cost surveys: a 3–5 person team runs $150k–$400k per year; solo opportunity cost is $40k–$100k per year.

### Scenario A: Solo (not recommended for the window)

- Timeline: slice 6–9 months, EA 2029, 1.0 2031.
- Cost: $200k–$400k opportunity cost over 4–5 years.
- Verdict: misses the 2030 beat. Comparables say five years. Only choose this if the window does not matter.

### Scenario B: Three-person core (recommended)

| Role | Owns |
|---|---|
| Gameplay engineer (C++/Blueprint) | Warden controller, camera, overlay, radial, Mass units, pathing at player-built walls |
| Technical designer / second engineer | Economy, threat, AI waves, level (the canyon), build pads, tuning |
| Art generalist | Warden, 4 units, 5 buildings, canyon set, UI, trailer stills |

Contract: audio (per-milestone), VO scratch, a producer for the publisher pitch if needed.

- Timeline: slice 5 months, demo June 2027, EA H1 2028, 1.0 2029.
- Cost: $400k–$1.0M through 1.0 (2.5 years at $150k–$400k per year plus contractors and tools).
- Verdict: hits every beat in §2 with margin.

### Scenario C: Six-person team

- Timeline: slice 4 months, demo Feb 2027, EA late 2027, 1.0 late 2028.
- Cost: $1.2M–$2.5M through 1.0.
- Verdict: fastest, but requires funding before the slice exists, which is the wrong order. Publishers in 2025–2026 fund playable slices, not paper.

**Funding path for Scenario B:** self-fund or angel the slice (months 1–6), pitch publishers with the slice plus playtest data (months 6–9). Publishers want to be pitched 12–18 months before launch, which lines up with an EA launch in H1 2028. Typical splits are 50/50 to 80/20 in the developer's favor depending on services.

-----

## 6. Timeline, Scenario B

| Phase | Months | Deliverable | Gate |
|---|---|---|---|
| 0. Setup | 0–1 | Name locked, Steam Coming Soon page, teaser, repo, UE5 project with Mass units walking | Page live within 30 days of the Blizzard announcement |
| 1. Graybox slice | 1–3 | GDD §12 freeze list in graybox. Warden, 4 units, 5 buildings, canyon, Broodveil waves, threat meter | Overlay ≤150 ms, first order ≤1.0 s. Testers switch views unprompted. If not, no new systems. |
| 2. Slice polish | 3–6 | Art pass on the freeze list, audio, first external playtest (20+ testers) | Testers can name the minute they lost (GDD §13). Retention across three sessions. |
| 3. Pitch and demo | 6–9 | Publisher deck with playtest data. Next Fest June 2027 demo build submitted by deadline. | Wishlist velocity during Next Fest. Publisher term sheet or decision to stay independent. |
| 4. EA content | 9–18 | Choir faction, mixed spawns, 4–6 sites, Doctrine roster, Keel loadouts, save/extract meta, co-op investigation only | Content complete for EA. Counter-trailer ready for BlizzCon 2027. |
| 5. Early Access | 18–20 | EA launch H1 2028 | Reviews, refund rate, concurrent players |
| 6. EA to 1.0 | 20–30 | Warden tree, galaxy mission select, more sites, second Warden loadouts if data supports | 1.0 in 2029 |

Slack built in: about 3 months across phases 4–6. If phase 1 misses its gate, everything shifts and the June 2027 demo becomes the BlizzCon 2027 counter-trailer instead.

-----

## 7. Legal and brand risk

**Title.** "Dominion" is the name of the Terran government in StarCraft. Blizzard has a documented history of cease-and-desist letters against fan projects, including a StarCraft II mod that was shut down after a single YouTube video. Blizzard's published trademark guidelines are restrictive. Separately, "Dominion" is a registered trademark for a well-known card game in the games class. A title using that word invites two disputes before launch.

Recommendation: retire "Dominion" as the title now. Keep "FRIENDSLOP" as the subtitle or the studio brand, where the joke lives anyway. Pick a title that is an original noun. The GDD's own working names (Compact, Broodveil, Choir, Warden, Keel) are the model.

**Parody.** Poking fun at the announcement is fine as long as the game uses no Blizzard marks, logos, unit names, or art. Trailers can reference "a certain 2030 release" without naming it. Store page copy should never use "StarCraft" as a keyword or tag. Press can make the comparison for us.

**Tone risk.** The FriendSlop bit works only if the build is good. A parody of slop that is itself slop gets reviewed as slop. GDD §14 already says this. It is the biggest reputational risk on the project.

-----

## 8. Technical risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| View-switch feel is bad | Medium | Fatal | Phase 1 gate. Prototype the overlay before any unit exists. |
| Pathing around player-built walls | High | High | Nav mesh rebuild on placement is a known Unreal pain. Budget two engineer-weeks in phase 1. Pads on a grid limit the problem. |
| Unit count vs. performance | Low for slice, medium for EA | Medium | Mass Entity from day one. Vertex-animation crowds for Broodveil chaff if skeletal counts pinch. |
| Threat tuning produces one dominant style | Medium | High | Telemetry from playtests: base footprint at loss, time in overlay, style split. Pillar 2 is measurable. |
| Co-op demand | High | Medium | Hybrids get asked for co-op immediately. Do not promise it. Investigate in phase 4 only. |
| Scope creep in Early Access | High | High | Both comparables spent five years in EA. Publish a fixed EA roadmap with an end date. |
| Unreal iteration time slows a 3-person team | Medium | Medium | Blueprint for gameplay, C++ for Mass and pathing only, hot reload discipline. |

-----

## 9. Go / no-go checkpoints

1. **Day 30:** Steam page live, name locked, Mass units walking in the canyon graybox. If not, the team is not fast enough for the window and should plan a 2029 release without the Blizzard beat.
2. **Month 3:** overlay budget hit and testers switch views unprompted. If not, stop and fix control. Do not proceed to art.
3. **Month 6:** external playtest shows testers using the failure vocabulary. If they say "I didn't know what to press," return to month 3.
4. **Month 9:** Next Fest wishlist data and publisher response. Decide funding path for EA.
5. **Month 18:** EA content complete and counter-trailer shipped. If EA slips past mid-2028, cut sites rather than slip.

-----

## 10. Sources

- BlizzCon 2026 StarCraft announcement: Game Informer, Variety, gHacks, VideoCardz (12–13 Sep 2026)
- Silica: Bohemia Incubator page, Steam store, Niche Gamer, MMOBomb
- Executive Assault 2: Saving Content, Indie Game Website, Games Press
- Unreal Mass Entity RTS performance: Epic Developer Community forums (RTS Unit Template), Fab listing, Epic for Indies Mass AI tutorial, On All Fronts (GitHub)
- Indie cost surveys 2026: Steam Page Analyzer, Juego Studio, Kevuru Games
- Publisher pitching 2026: FirstLook.gg, Outlook Respawn, game-developers.org
- Steam Next Fest dates: Steamworks documentation (Feb 2027, June 2027)
- Engine comparison 2026: Ocean View Games, DEV Community, itch.io blog
- Blizzard cease-and-desist history and trademark guidelines: Techdirt, Slashdot, Blizzard Legal
