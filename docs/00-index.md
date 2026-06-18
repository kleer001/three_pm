# Spec 00 — Index & map of the 3pm design corpus

Top-down, real-time-action roguelite. This file maps the full spec set (01–16):
what each doc owns, which interfaces it freezes, and where the content data and
the cast live. Specs are the contract; numbers inside them are tuning, not.

## Premise (spec 14)
The final bell rings at 3pm and the suburbia around Merriton High has gone
wrong — recognizably home, but rotted, cratered, and crawling with cartoon-terror
horrors. Nine 16-year-olds try to walk home alive before dark. A **run = one
in-game "day"**; the kid starts at the **north** edge and home is the fixed
**south** band. A slow camera auto-scrolls southward, holding the hero inside
its window — descent home is forced. A kids' GPS smart-watch reads
**depth/distance to home** (home is always downhill, due south). Each day's
**seed regenerates the neighborhood**, so the map differs every day — the
in-fiction proof the day reset. Roguelite: dying resets the kid to another 3pm
(groundhog-day), spending banked currency on **per-hero permanent upgrades**,
with new heroes **unlocked by run count**. Win = reach the south home band.

## Locked high-level decisions
- Top-down, **real-time action**; WASD move, mouse aim (360°).
- **Single fixed-size suburban map** per day; **forced southward descent** — a
  slow camera auto-scrolls south at a fixed rate, holding the hero in its window.
- **Open-tile suburb generation**: jittered street grid → blocks/lots → houses →
  cellular-automata **decay pass** → connectivity repair → north start + south
  home band.
- **Win = reach the south home band**; hero starts at the north edge. **No
  boss**; pure descent. Death (hp ≤ 0) is the only other end state.
- **Free-move + per-axis AABB** vs the walkable tile grid (no pathfinding).
- **One unified component entity schema**; entities = bags of components, built
  data-driven by a factory.
- **HP bar + mana pool**; four base stats (speed/con/str/magic) → derived values.
- **Per-character basic + signature**; both are one `Attack` schema, differ only
  by data (signature = `manaCost > 0` + cooldown).
- **In-run powerups**: world drops + shops; one in-run currency (**scrap**);
  whole-run permanent; stacking with declarative **synergies**.
- **Persistent meta**: banked **credits** (distinct from scrap), per-hero
  **upgrade trees**, **unlock-by-run-count**, groundhog-day death framing.
- **Sprite-sheet (bitmap atlas) rendering** through canvas 2D; fixed-timestep sim.
- **Full HUD**: HP/mana bars, signature cooldown, **depth/distance-to-home
  readout**, scrap counter, minimap.
- **Audio = SFX (event-driven) + per-scene looping music** via WebAudio.

## Spec map
| # | Title | Purpose | Key owned interfaces / data |
|---|---|---|---|
| 01 | Core engine + run loop | Engine skeleton; no content | Fixed-timestep `Loop.start`, `Scene{enter/update/render/exit}`, scene FSM, seeded `makeRng` + sub-streams, seed-derived "day", `runState` + `meta/save` tiers, `events` pub/sub |
| 02 | World / level structure | One fixed suburban map per day | `generate(seed,params)->Level`, `Level` shape, tile-type enum + `walkable`, gen pipeline (grid→houses→CA decay→repair), north start + south home band, forced south auto-scroll, win check (player tile ∈ homeBand), tile/world coord convention |
| 03 | Entity & stats model | Unified component schema | Component set + fields, four base stats → `derived` formula + balance constants, `recomputeDerived(entity)`, per-axis AABB-vs-walkable movement, `spawn(defId, overrides)` factory |
| 04 | Combat & interaction | One attack resolver for all offense | `Attack` descriptor (incl. `deploy` shape + payload), signature def rule, `useAttack(entity,attackId,aim)`, `applyDamage(target,amount,source)`, opposite-faction damage rule, contact/iframe/cooldown/mana fields, mouse→world `aim` |
| 05 | Characters: format + Marvin | `characters.json` schema + starter | Character entry schema, 1–10 stat scale (5 = baseline, Marvin all-5s), `spawn('hero:<id>')`, `unlockAtRuns` gate, `projectile.count`/`spread` extension |
| 06 | Enemies: roster + AI | Threat roster, AI, director | `brain(entity,world,dt)` contract, four behaviors (`chaser/shooter/charger/swarmer`) + `brainFor`, `enemies.json` schema, `spawn('enemy:<id>')`, director `budget(f)` + `distanceBand` eligibility + off-screen placement |
| 07 | In-run powerups | Run-scoped buffs (drops + shops) | `powerups.json` schema + per-`kind` `mods`, `applyPowerup`/`applyHeld` rebuild-from-base, `synergies.json` + `applySynergies`, drop path (`loot` RNG + `death` + `spawnPickup`), shop path (`scrap`, `buy`) |
| 08 | Meta-progression + save | Durable tier + payout + unlocks | `SaveBlob` + `KEY` + migration, `meta/save.js` API (`load`/`save`/`bankCurrency`/`recordRun`/`purchaseUpgrade`/`isHeroUnlocked`), payout formula, `upgrades.json` + `applyHeroUpgrades`, `recomputeUnlocks`, `meta:hero-unlocked` event |
| 09 | Presentation | Render / camera / HUD / audio | `render(alpha)` interpolation + 4-layer order + y-sort, `sprites.json` + `sprite` anim state + `advanceSprite`, camera forced-south auto-scroll + clamp + cull, HUD element→source table + depth-to-home readout, `audio` API + `audio.json` + per-scene music + event SFX |
| 10 | Hero: The Varsity | Melee bruiser content | `varsity` char entry, `unlockAtRuns: 1`, `stun:<s>` effect token |
| 11 | Hero: The Occultist | Glass-cannon mage content | `wendolyn` char entry (freezes no new interface) |
| 12 | Hero: The Track Star | Fast skirmisher content | `dash_velocity` char entry, `unlockAtRuns: 5`, `dash:far`/`iframes:short` effect tokens |
| 13 | Hero: The Robotics Nerd | Zoner / control-tank content | `robotics` char entry, `unlockAtRuns: 8`, `Attack.shape: deploy` + `deploy` block + nested `turret`, `deployable:<id>` factory namespace |
| 14 | Story & tone bible | Premise, watch lore, cartoon-terror | None (content/tone reference only); dresses specs 01/02/05/06/09/10–13 |
| 15 | Run summary: DEATH/VICTORY | The two resolution scenes | `RunResult` shape, commit-once flow (`save(recordRun(load(),result))` guarded by `_committed`), end-reason mapping, payout breakdown lines, `(DEATH\|VICTORY)→META` wiring |
| 16 | Title, menus, scene flow | Completes the scene FSM | Full scene graph, `HERO-SELECT` (sole commit path into `RUN.enter()`) + `PAUSE` overlay, TITLE/SETTINGS items + gain sliders, added-scene music, shared menu focus model |
| 19 | Roster: the nine | 9-hero music-genre cast + signatures | Nine heroes (one per genre), per-hero signature names + mechanics, conga-train signature constraint, BPM Boost / Slow Jam powerups, net-new effect primitives (slow/confuse/DoT/passive-heal/turret/charge/time-scale); supersedes spec 05's five-hero cast |

## Frozen-interface cross-reference
Each major engine contract and the spec that owns it. Consumers must route
through these, not reach around them.

| Interface / contract | Owner |
|---|---|
| Fixed-timestep loop, `render(alpha)`, `Scene` interface | 01 |
| Scene FSM skeleton (`TITLE→RUN→DEATH\|VICTORY→META`) | 01 (completed graph + HERO-SELECT/PAUSE in 16) |
| Seeded `makeRng` + sub-streams (`gen`/`spawns`/`loot`) | 01 |
| `runState` tier + `meta/save` blob shape + `KEY` + `events` | 01 (save API + schema detailed in 08) |
| `generate(seed,params)->Level`, `Level` shape, tile model, win check | 02 |
| Forced-south camera auto-scroll + clamp bound `[0, w*tileSize - viewport]` | 02 (draw + cull math in 09) |
| Component schema + field names; balance constants | 03 |
| `recomputeDerived(entity)` (spawn + any stat change) | 03 |
| Per-axis AABB-vs-`walkable` movement resolution | 03 |
| `spawn(defId, overrides)` factory + `deployable:<id>` namespace | 03 (namespace introduced in 13) |
| `Attack` descriptor (basic + signature + `deploy` shape/payload) | 04 |
| `useAttack(entity,attackId,aim)` / `applyDamage(target,amount,source)` | 04 |
| Faction rule: a hit source damages the **opposite** faction; `player`(hero + deployables) ↔ `enemy`; `neutral` never | 04 (reaffirmed for enemies + deployables in 06/13) |
| `contactDamage` / `iframes` / `cooldowns` / `projectile` / `mana.regen` fields | 04 |
| Mouse→world `aim` derivation | 04 |
| `characters.json` entry schema + 1–10 scale + `unlockAtRuns` | 05 |
| `brain(entity,world,dt)` + four behaviors + `brainFor` | 06 |
| `enemies.json` schema; director `budget(f)`/`distanceBand`/`spawns` RNG | 06 |
| `powerups.json` + `applyPowerup`/`applyHeld` rebuild-from-base | 07 |
| `synergies.json` + `applySynergies` (a synergy IS an `applyPowerup` mod) | 07 |
| Drop path (`loot` substream + `death` + `spawnPickup`); shop path (`scrap`, `buy`) | 07 |
| `meta/save.js` API + `SaveBlob` + migration + payout | 08 |
| `upgrades.json` + `applyHeroUpgrades` (before `recomputeDerived` at run start) | 08 |
| `recomputeUnlocks` (`runCount >= unlockAtRuns`) + `meta:hero-unlocked` | 08 |
| `render(alpha)` interpolation + 4-layer order + y-sort | 09 |
| `sprites.json` + `sprite` anim state + `advanceSprite`; camera auto-scroll/cull | 09 |
| HUD element→source table + depth/distance-to-home readout | 09 |
| `audio` module API + `audio.json` + per-scene music + event-driven SFX | 09 |
| `RunResult` payload + commit-once resolution flow | 15 |
| Complete scene graph; `HERO-SELECT` commit path; `PAUSE` overlay rules | 16 |

## Content registries (JSON data files)
| File | Defined by | Holds |
|---|---|---|
| `content/characters.json` | 05 (entries added by 10–13) | Hero defs: stats, `basic`/`signature`, `unlockAtRuns`, sprite |
| `content/enemies.json` | 06 | Enemy defs: family/tier, behavior, stats, `contactDamage`, optional `attack`, `threatValue`, `distanceBand` |
| `content/powerups.json` | 07 | Powerup defs: rarity, kind, target, `mods`, stackable, cost |
| `content/synergies.json` | 07 | Held-set combos: `requires` + powerup-style `mods` |
| `content/upgrades.json` | 08 | Per-hero meta upgrade trees: `maxRank`, `costCurve`, run-start `apply` |
| `assets/sprites.json` | 09 | Atlas sheet + `frames` rects + named `anims` (frames/fps/loop) |
| `assets/audio.json` | 09 | `sfx` + `music` id→file registry |

Note: spec 03 references character/enemy defs as loaded into one entity registry;
the JSON files themselves are owned by 05 (characters), 06 (enemies), 07
(powerups/synergies), 08 (upgrades), and 09 (sprites/audio).

## Cast roster (specs 05, 10–13)
| id | Name | Archetype | Slot | Stat headline (spd/con/str/mag) | `unlockAtRuns` |
|---|---|---|---|---|---|
| `marvin` | Marvin Merrick | The Median | onboarding baseline | 5 / 5 / 5 / 5 — all-average | 0 |
| `varsity` | Chad Brawnson | The Varsity | melee bruiser | 3 / 8 / 9 / 2 — strength peak, magic dump | 1 |
| `wendolyn` | Wendolyn Crowe | The Occultist | glass-cannon mage | 5 / 2 / 3 / 9 — magic peak, con dump | 3 |
| `dash_velocity` | Dash Velocity | The Track Star | fast skirmisher | 9 / 2 / 5 / 4 — speed peak, con dump | 5 |
| `robotics` | Eugene Okafor | The Robotics Nerd | zoner / control-tank | 2 / 8 / 3 / 8 — con + magic high, speed dump | 8 |

## Process & production docs (not part of the design contract)
These freeze no interfaces and own no game data — they're guidance, not spec.
| File | Holds |
|---|---|
| `playtesting-and-launch-roadmap.md` | Research-backed playbook for taking 3pm from playable slice to public itch.io / GitHub Pages release: recruiting/running playtests, honest metrics & telemetry, milestone ladder, indie failure modes |
| `playtest-session-kit.md` | Hand-tools: recruiting message, moderated-session script, debrief, one-page survey, and the analytics setup that activates `src/run/telemetry.js` |
