# Spec 18 — Player-driven time + grid movement (proposed variant)

A proposed control/time model for the RUN scene: **the world only moves when the
player moves.** Bullets, enemies, and the encroaching doom advance on a clock
the player drives with their feet — frozen when still, full-speed when sprinting,
bullet-time when deliberate. Movement is **grid-constrained, 4-directional**.

This is the SUPERHOT mechanic ("time moves only when you move") ported to a
top-down descent roguelite. Its purpose is **accessibility without dilution**:
it relocates difficulty from twitch reflex to spatial reasoning, so a bullet-hell
becomes a self-paced puzzle. It is a deliberate divergence from the locked
real-time/free-move decisions in specs 00–03/09 — see *Supersedes* below.

## Decisions in force
- **World-time is player-driven.** A single `timeScale` gates all non-hero
  simulation. The hero's *input and step animation* run at real wall-time
  (always responsive); everything else is multiplied by `timeScale`.
- **Grid-constrained, 4-directional movement.** The hero occupies one tile and
  steps to an orthogonally-adjacent tile. No diagonals. (hjkl / WASD / arrows
  already map cleanly — spec, `input/input.js`.)
- **Single hero.** Matches the `src/` slice. A party of five is a natural
  extension of this clock (move one, the world ticks) but is **deferred**.
- **Soft deadline only.** The doom is pushed by the **idle ooze + the player's
  steps**. There is no hard wall-clock or step-budget "3pm" timer. You set the
  pace; the only floor is that the ooze never fully stops.

## The clock (`timeScale`)
The whole design is one derived value, recomputed each frame from the hero's
locomotion state:

```
timeScale =
  STEP_IN_PROGRESS ? MOVE_SCALE        // ≈ 1.0 — a tile-step is animating: real-time
  FIRED_THIS_FRAME ? SHOT_TICK         // a slingshot shot spends a chunk of clock
                    : OOZE_SCALE        // small ε — standing still: the world crawls
```

- **Flow during the step, ooze between** (the chosen model): because a step
  animates over `STEP_DUR`, *fast consecutive* steps keep `timeScale ≈ 1`
  (feels like real-time action), while a *single deliberate* step followed by a
  pause averages down toward the ooze (feels like bullet-time). The speed dial
  is literally in the player's feet — no setting, no menu.
- **Everything non-hero consumes `dt * timeScale`:** enemy brains/movement,
  enemy + hero projectiles, enemy windup/recover/cooldown timers, the freeze
  countdown, and the crush. One multiply, applied at the sim boundary.

```
worldDt = dt * timeScale
stepWorld(worldDt)        // enemies, bullets, crush, all timers
stepHero(dt)             // input + step interpolation: ALWAYS real wall-time
```

## What gates, what doesn't
The single most important rule. Get this wrong and it feels broken.

| System | Clock |
|---|---|
| Hero input read + step animation | **Real wall-time** (never gated) |
| Enemy AI / movement (BFS, spec 06 / `ai.js`) | `worldDt` |
| Enemy + hero projectiles | `worldDt` |
| Enemy windup / recover / cooldown; freeze countdown | `worldDt` |
| The crush / encroaching doom | `worldDt` |
| HUD, camera follow, the wobble boil (spec 09) | Real wall-time (cosmetic) |

## Grid movement model
- Hero state is a **tile** + an in-progress step (`from`, `to`, `t∈[0,1]`).
- A buffered cardinal input starts a step iff the target tile is **walkable**
  (`levelgen.js` walkable grid) **and unoccupied**. The step interpolates over
  `STEP_DUR` real seconds; `timeScale = MOVE_SCALE` for its duration.
- **Collision collapses.** Continuous AABB + soft-body separation
  (`collision.js`, the `separate`/`shift`/`bodyDeeper` machinery in
  `runScene.js`) exists only because motion is sub-pixel. On a grid a tile is
  occupied or it isn't — most of that code retires.
- **Enemies become grid-native.** `ai.js` BFS already returns tile paths; today
  they're *steered* toward tile centers. Here the path step *is* the move — one
  tile per enemy step, advanced on `worldDt`. Hero and enemies finally share one
  movement space.
- **Bullets thread lanes.** Projectiles advance on `worldDt`, so while you stand
  still they hang in the air; you walk between them at your own pace.

## Combat under the clock
- Keep the slice's **freeze-slingshot** (auto-aim nearest, two freezes kill).
- **Firing spends clock** (`SHOT_TICK`): otherwise a stationary player machine-guns
  a frozen diorama and combat is free. A shot advancing the world a beat keeps it
  a real decision.
- Enemy **telegraphs are readable while paused** — windup rings, ranged aim lines
  (spec 04) all sit frozen on the board, so you plan the step, then commit. This
  is the Into-the-Breach legibility falling out of the freeze for free.

## The ooze, and why it's nonzero
`OOZE_SCALE` is small but **> 0**. A true hard-freeze removes *all* pressure and
lets the player camp forever — fatal to 3pm's encroaching-doom identity. The ooze
means standing still is a *temporary* refuge: the crush keeps creeping, just
slowly. Reflex-free, not tension-free. This is the line that keeps it horror
rather than a stationary puzzle.

## Tuning constants (data, not contract — belong in `balance.js`)
Per the project's "numbers are tuning" rule, these live in the data module
(`src/run/balance.js`), not in code paths:

| Const | Meaning | Starting feel |
|---|---|---|
| `STEP_DUR` | real seconds for one tile-step | ~0.12 s (snappy) |
| `MOVE_SCALE` | `timeScale` while a step animates | 1.0 |
| `OOZE_SCALE` | `timeScale` while idle | ~0.05 (a slow crawl) |
| `SHOT_TICK` | clock spent firing the slingshot | ~one step's worth |
| `crushBase` | doom advance per second of `worldDt` | tune vs descent length |

## Synergy with the flat-color wobble (spec 09 / `art-test/wobble.html`)
A gated world has one failure mode: when frozen it looks like a **paused
screenshot**. The boiling-line wobble — which runs on real wall-time, not
`worldDt` — keeps stopped enemies and hanging bullets shimmering, so a held
board reads as *alive and waiting*, not switched off. The two ideas are one
aesthetic: time stops, but nothing looks dead.

## Supersedes (reconciliation with the locked corpus)
This variant explicitly overrides these otherwise-frozen decisions; everything
else in 00–17 stands.

| Prior decision | Owner | Replaced by |
|---|---|---|
| Real-time action; world runs on wall-clock | 00, 01 | Player-driven `timeScale` |
| Free-move + per-axis AABB vs walkable | 00, 03 | Grid tile-step + occupancy |
| Mouse aim, 360° | 00 | Auto-aim nearest (slice already does this); 4-dir locomotion |
| Forced south auto-scroll at a fixed rate | 00, 02, 09 | Crush advances on `worldDt` (ooze + steps) |

**Kept unchanged:** seeded RNG + day model (01), the suburb gen pipeline and
`Level`/walkable/home-band/win-check (02), enemy roster + BFS brains (06),
powerups/meta/scene-FSM (07/08/16). The map is already a grid; this leans into
that rather than fighting it.

## Open / deferred
- **Party of five** — the clock makes it feasible (each kid's move ticks the
  world); deferred to keep this single-hero like the slice.
- **8-directional movement** — rejected for now (complicates aim, bullet
  geometry, crush rows); revisit if 4-dir feels too rigid.
- **Hard "3pm" deadline** — rejected for now (kept purely self-paced); the title
  could still motivate an optional global budget later.
- **Speed stats vs the grid** — heroes/powerups that modify `speed` (spec 03/07)
  must reinterpret it as **shorter `STEP_DUR`** (or extra steps), not px/s. Needs
  a conversion rule before those systems land.
- **Enemy "free" turns** — confirm enemies never act on the ooze faster than the
  player can read (they share `worldDt`, so they shouldn't, but verify under
  rapid stepping).

## Interfaces this spec would freeze
- `timeScale(heroLocomotion) -> float` and the `worldDt = dt * timeScale` split
  at the sim boundary (hero excluded).
- Grid hero state (`tile` + `{from,to,t}` step) and the walkable-**and**-unoccupied
  step-start rule.
- "Firing spends clock" (`SHOT_TICK`) as the rule that keeps combat non-free.
