# Feasibility and Timeline

Version 1.0 · 2026-09-13 · Companion to `GDD.md`
Changelog 1.1: phase 0 is a GameMaker 2D prototype; Godot is the 3D port target.
Changelog 1.0: rewritten around a sub-$20k experiment as the primary path. The three-person studio plan is retained as a conditional second stage. Title retired. Dates now follow the slice gate instead of the other way round.

-----

## 1. The honest sentence

You cannot afford the studio version of this game. You can afford the experiment the GDD was written for. If the experiment is good, the $400k conversation happens with someone else's money. If it is bad, you still have a helmet pack and your rent.

The window is real. The product is still the trade. Ship the canyon, then print the date.

-----

## 2. What is settled

- The slice (GDD §12/§17) gates everything.
- *Dominion* is retired as a title. Shortlist in GDD header.
- Hybrids take years when scope is open (*Silica*, *Executive Assault 2*, both about five years to or through Early Access).
- Blizzard's Spring 2030 date is a finish line, not a genre license. Announced at BlizzCon on 12 Sep 2026 as an open-world shooter, cinematic only, led by Dan Hay.
- The brand risk is a parody of slop that is itself slop.

-----

## 3. Stage one: the experiment ($0–$20k, one person)

The whole company until the switch is fun.

**Keep:** third person, 50% overlay, walk-to-build, 4 units, 5 buildings, one nest, extract, Warden death fails.

**Drop, later or forever:** crowd-scale unit counts, second faction, doctrines, Keel meta, co-op, a Steam page this month, a counter-trailer for BlizzCon.

**Army cap:** 20–40 units. Basic engine agents. No crowd framework.

**Engine reality:** the only engine known is GameMaker. So phase 0 is a 2D top-down prototype in GameMaker (GDD §15). It answers the switch question at zero learning cost. The 3D port goes to Godot 4 after the prototype passes, because Godot is free and the closest in feel to GameMaker. Learning Godot is a phase of its own and is budgeted below. Unreal is deferred to stage two.

### What the money buys

| Path | Cost | What you get |
|---|---|---|
| You + AI, nights and weekends | Software and credits, **$50–$200/mo** | Graybox in 3–8 weeks if you already know an engine |
| You + one contractor for agents/pathing only | **$3k–$8k**, short burst | Units that walk and collide with a wall you placed without melting the frame |
| You + one artist for a week of kitbash | **$1k–$3k** | The toy-institutional look (GDD §18) locked |
| Publisher or angel | $0 now | Only after a video of the trade working |

There is no honest $50k version of "4–6 sites, second faction, Next Fest, Early Access." That number is payroll.

### Time, not money

| Phase | Effort | Deliverable | Gate |
|---|---|---|---|
| 0. GameMaker prototype | Nights, weeks 1–8 | 2D top-down: Warden, 50% overlay, radial, walk-to-build, 20–40 rectangle units, one wall, one nest, extract | Overlay ≤150 ms (trivial in 2D), first order ≤1.0 s, testers switch views unprompted, testers can name the minute they lost |
| 1. Godot controller | Nights, months 3–4 | Learn Godot 4 by building only a third-person controller you could ship. Nothing else. | Controller feels good to a stranger. Do not start buildings. |
| 2. Godot port | Nights, months 4–7 | The prototype's systems in 3D, 20–40 units, pads on a grid, one canyon | Same gate as phase 0, now in 3D |
| 3. Look | Nights, months 7–9 | Airline-plastic world (GDD §18), canyon scale, rain, creep, radio VO pass | Testers name the minute they lost, again |
| 4. Clip | Week after phase 3 | 40 seconds: overlay → wall → core almost dying | Wishlist after this clip, never before |

The GameMaker phase is the cheapest possible kill switch. If the trade is not fun as rectangles, stop at week 8 with nothing lost but evenings. If it is, the Godot learning curve is paid for by knowing exactly what to build.

If the switch fails at month 3, you spent evenings, not a house.

### Spend the next dollar on, in order

1. Nothing. GameMaker is already owned. Godot is free. Do not buy an engine or a crowd stack.
2. A cheap mic and one radio VO pass.
3. One contractor week, only after *you* have units colliding with a wall you placed.
4. The $100 Steam fee, only after testers name the minute they lost.

-----

## 4. How the 2030 window is still used

You do not outspend Blizzard. You post the slice when the verb works. The 40-second clip is the pitch. A Coming Soon page with the wrong stills or no verb trains the wrong audience, and you never get them back.

Capture points that survive the budget:

| When | Beat | Condition |
|---|---|---|
| After phase 3 | Clip, then Steam page in the GDD §18 style | Switch gate passed. Teaser is toy-institutional, not BlizzCon concept art. |
| First Next Fest after the page | Demo | Only if the month-3 gate passed. Booking a Fest on a failed switch is shipping FriendSlop for real. |
| BlizzCon 2027 or 2028 | Counter-clip the week they show gameplay | Only if a build exists that a stranger can play. |

Next Fest runs February, June, and October. A game enters once. Do not spend the one entry on a rough build.

-----

## 5. Stage two: the studio (conditional, someone else's money)

Enter only with a slice that passed phases 1–3 and a clip that got a publisher or angel to reply.

**Team shape that matches the GDD, three people only:**

1. Systems, camera, overlay. The game.
2. Agents, units, buildings. The other half of the game.
3. Art direction and world kit. The joke made consistent.

AI fills mesh volume. It does not sit in the third chair. If one of the three is "AI wrangler / producer," the switch will slip.

**Engine:** Unreal plus Mass Entity is the correct default once "army on screen" grows past the 40-unit cap. Until then it is not needed.

**Cost:** $400k–$1.0M through 1.0 is liveable for three people only if two are already fluent in the engine and nobody is learning the crowd stack from forum threads on the clock. Add six months if the RTS layer is new to the team.

**Timeline:** slice pass → then date. Not date → then slice. With a passed slice in hand, a plausible shape is Early Access 18 months after funding and 1.0 roughly a year after that. Those dates are written only after the gate, never before.

**Funding:** publishers in 2025–2026 fund playable slices with playtest data, not paper. They want to be pitched 12–18 months before launch. Splits run 50/50 to 80/20 in the developer's favor depending on services.

-----

## 6. Go / no-go

| Gate | Fail looks like |
|---|---|
| Day 30 | No name, or the teaser looks like Blizzard concept art |
| Week 8 | Rectangle prototype: testers have to be told to switch, or cannot name the minute they lost |
| Month 4 | Godot controller does not feel good to a stranger |
| Month 7 | 3D port fails the gate the 2D prototype passed |
| Month 6 | Testers cannot name the minute they lost |
| Month 9 | No publisher *and* no path to self-fund the next year |
| Month 18 | Second faction made the army wallpaper or the hero a QTE |

Gates through month 7 belong to stage one. Gates 4–5 exist only if stage two starts.

-----

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| View-switch feel is bad | Medium | Fatal | Phase 0 gate, in 2D, before any 3D work. |
| Learning Godot eats the calendar | High | Medium | Phase 1 is only a controller. Nothing else is allowed until it feels good. The prototype already says what to build. |
| 2D prototype passes, 3D port fails | Medium | High | Phase 2 gate. If 3D breaks the trade, ship the 2D game. A 2D action-RTS with the trade intact is still the product. |
| Pathing at player-built walls | High | High | Pads on a grid. Nav rebuild on placement. The one contractor burst goes here if you cannot solve it. |
| Threat tuning produces one dominant style | Medium | High | Log base footprint at loss, time in overlay, style split. Pillar 2 is measurable. |
| Steam page before the verb | High | High | No page until the clip exists. |
| Title dispute | High if *Dominion* stays | High | Retired. Pick from the shortlist this week. |
| Co-op demand | High | Medium | Do not promise it. |
| Scope creep if stage two starts | High | High | Publish a fixed EA roadmap with an end date. Both comparables spent five years in EA. |
| Parody of slop that is slop | Medium | Fatal to the brand | GDD §14 and §18. Silly materials, serious numbers. |

-----

## 8. Sources

- BlizzCon 2026 StarCraft announcement: Game Informer, Variety, gHacks, VideoCardz (12–13 Sep 2026)
- Silica: Bohemia Incubator page, Steam store, Niche Gamer, MMOBomb
- Executive Assault 2: Saving Content, Indie Game Website, Games Press
- Unreal Mass Entity RTS performance: Epic Developer Community forums (RTS Unit Template), Epic for Indies Mass AI tutorial
- Indie cost surveys 2026: Steam Page Analyzer, Juego Studio, Kevuru Games
- Publisher pitching 2026: FirstLook.gg, Outlook Respawn, game-developers.org
- Steam Next Fest dates: Steamworks documentation (Feb 2027, June 2027)
- Engine comparison 2026: Ocean View Games, DEV Community, itch.io blog
- Blizzard cease-and-desist history and trademark guidelines: Techdirt, Slashdot, Blizzard Legal
