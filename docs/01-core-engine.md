# Spec 01 — Core engine + run loop

Engine skeleton for a top-down, real-time-action roguelite. No game content here.

## Decisions in force
- Top-down, real-time action.
- A **run = one in-game "day"**; death or arriving home ends it.
- Persistence has two tiers: volatile `runState`, durable `meta/save`.
- Everything random derives from one per-run **seed**.

## Fixed-timestep loop (`core/loop.js`)
Decouples simulation from frame rate so physics/combat are deterministic.

```
DT = 1/60                      // sim step, seconds
accumulator += frameDelta      // clamp frameDelta to 0.25s to avoid spiral
while (accumulator >= DT) { update(DT); accumulator -= DT }
render(accumulator / DT)       // alpha for interpolation
```

- `update(dt)` advances the active scene. `render(alpha)` interpolates between
  last and current state for smooth motion.
- Single `requestAnimationFrame` driver. The loop owns no game state.

## Scene state machine (`core/scene.js`)
One active scene; transitions are explicit. Scenes implement
`enter() / update(dt) / render(alpha) / exit()`.

```
TITLE → RUN → (DEATH | VICTORY) → META → RUN ...
```
- `RUN` holds the live game. `META` is the between-runs screen (unlocks, upgrade
  spend). DEATH/VICTORY are resolution scenes that commit results to `meta/save`.

## Seeded RNG (`core/rng.js`)
`mulberry32` (or equivalent) — small, fast, seedable, reproducible.

- `makeRng(seed) -> { next(): float[0,1), int(n), pick(arr), chance(p) }`.
- A run's seed is chosen at `RUN.enter()`. Same seed → identical day (gen,
  spawns, loot). Enables debugging and daily-seed sharing.
- **Sub-streams:** derive independent generators per system
  (`gen`, `spawns`, `loot`) from the run seed so consuming one doesn't desync
  another.

## The "day"
- The run seed *is* the day: it regenerates the neighborhood (gen/spawns/loot)
  so each day differs. A day count + the regenerated map ground the
  groundhog-day fiction. Home is fixed due south; there is no per-day bearing.

## State tiers
| Tier | Module | Lifetime | Holds |
|---|---|---|---|
| Run | `run/runState.js` | one day, dropped on death | position, hp, held items, active seed, cleared progress |
| Meta | `meta/save.js` | persistent (localStorage) | unlocked characters, banked currency, purchased upgrades, stats |

`meta/save.js`: single JSON blob under one key, `{ version, ... }`, with a
version field so the schema can migrate. Run results flow Run → Meta only at
DEATH/VICTORY; nothing else writes meta.

## Events (`core/events.js`)
Minimal pub/sub (`on/off/emit`) so systems (combat, UI, audio) react without
hard references. Engine-level only; not a content mechanism.

## Boot (`main.js`)
Create canvas context → init save → start loop with `TITLE` scene. No content
imports at this layer.

## Interfaces this spec freezes
- `Loop.start(initialScene)`
- `Scene { enter, update(dt), render(alpha), exit }`
- `makeRng(seed)` and its method surface
- `runState` shape (fields above) and `save` blob shape + key
- `events.on/off/emit`

Downstream specs depend on these and must not reach around them.
