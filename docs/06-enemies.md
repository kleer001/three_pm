# Spec 06 — Enemies: roster + AI

Defines the enemy roster, the AI behavior set, the `enemies.json` schema, and
how the director spawns threat. Flavor is generic apocalypse horror — zombies,
ghouls, demons, cultists roaming the ruined suburbia. Enemies are entities built
by the spec 03 factory and fight through the spec 04 resolver; this spec adds no
new combat machinery.

## Decisions in force
- Roster is **families × tiers**: one family = one behavior, with weak→elite
  variants up the tiers. Tiers differ in stats/numbers, never in behavior.
- **Four AI archetypes only**: `chaser`, `shooter`, `charger`, `swarmer`. One
  behavior per family. No per-enemy state machines, no hybrids.
- Threat **scales with distance from the start edge**: density and tier rise the
  further the player has crossed, peaking near the home band. The `director`
  (`run/director.js`) reads that distance to budget spawns.
- Enemies are spawned by the director into `Level.regions` (spec 02), never by
  levelgen.

## Entity shape
An enemy is the spec 03 component bag with `brain` instead of `input`:

```
transform + movement + stats + derived + health + collider
          + faction('enemy') + brain + sprite   [+ mana if it casts]
```

`spawn(defId, overrides)` composes this from an `enemies.json` def (below). Stats
use the **1–10 scale, 5 = baseline** (spec 05); `recomputeDerived` maps them to
`moveSpeed`, `maxHp`, `dmgResist`, etc. Enemies are `faction: enemy`, so the
spec 04 faction rule (a hit source damages the opposite faction) makes them
damage every `player`-faction entity — the hero *and* any `player` deployable
(e.g. a summoned turret) — through both contact and projectiles.

## The `brain` contract
`brain` is a single **pure** function selected by the def's `behavior` field:

```
brain(entity, world, dt)
```
- `world` exposes read-only state: `world.target` — the nearest `player`-faction
  entity (the hero or a `player` deployable such as a turret), as a `transform` —
  and `world.walkable` + `world.tileSize` (the spec 02 `Level.walkable` grid) for
  line-of-sight / move sampling. Brains steer toward and aim at `world.target`,
  not the hero specifically, so deployables draw aggro like any threat.
- Output is **only**: it sets `entity.movement.intent` (a dir vector, normalized
  by the movement integrator) and may call `useAttack(entity, attackId, aim)`
  with `aim` = unit vector toward `world.target`. It writes nothing else.
- No pathfinding: intent is steering toward/away from the player against the
  walkable grid (the per-axis AABB resolver, spec 03, handles wall sliding).

A `behavior` registry maps the def string to one of four functions:

```
BEHAVIORS = { chaser, shooter, charger, swarmer }
brainFor(def) -> BEHAVIORS[def.behavior]
```

## Behavior archetypes
Each is one function. Tuning constants (ranges, timings) come from the balance
config, not the code.

| Behavior | Move | Attack | Notes |
|---|---|---|---|
| `chaser` | steer straight at target | `contactDamage` on overlap | the default melee; no ranged attack |
| `shooter` | hold a preferred range (advance if far, back off if close) | `useAttack` ranged when in range + off cooldown | needs `mana` if its attack costs it |
| `charger` | approach to lunge range, then telegraph, then dash | `useAttack` (fast short projectile / lunge hitbox) at end of telegraph | windup is the counterplay window |
| `swarmer` | steer at target, faster + jitter | `contactDamage`, low | cheap/fast/weak; only a threat in packs |

`target` is `world.target` — the nearest `player`-faction entity, hero or
deployable.

- **chaser** — set `intent` = unit(target − self). Damage is pure `contactDamage`
  via the spec 04 contact path; the brain never calls `useAttack`.
- **shooter** — let `d` = distance to target. If `d > range`, intent toward; if
  `d < range*backoff`, intent away (kite); else intent ≈ 0 (hold). When
  `d ≤ range` and the attack is off cooldown, `useAttack(self, 'shot', aimAtTarget)`.
  If the def sets `static: true`, the brain holds intent at 0 unconditionally — the
  shooter never advances or kites, it roots and zones a fixed spot (e.g. a downed
  Power Line, a Sprinkler Head). `static` is a movement modifier on the shooter
  behavior, not a fifth behavior; only `shooter` defs read it.
- **charger** — phases tracked in scratch fields on `entity.brain` (a plain
  object the function owns): `approach` until within lunge range → `telegraph`
  for a fixed windup (intent 0, sprite tell) → `lunge` (intent locked at the
  aim captured at telegraph start; fire its lunge `Attack`) → cooldown →
  `approach`. The lock means a sidestep during telegraph dodges it.
- **swarmer** — like chaser but higher `moveSpeed` and a small per-entity heading
  jitter so packs spread instead of stacking on one pixel. Contact damage only.

## Modifiers (orthogonal to behavior)
Small flags / attack-data that ride on a behavior and combine across families —
variety without new AI. `static` (above) is the first; the rest:

- **`exploder`** (charger) — instead of surviving its lunge, it detonates an AoE on
  contact/death. The blast is **all-faction**: it damages every entity in radius —
  the hero *and* other enemies — an explicit exception to the spec 04
  opposite-faction rule. So an exploder can be baited into a pack.
- **spread** (shooter attack) — fires multiple projectiles in a fan via the spec 05
  `projectile.count`/`spread` fields. A shooter family may *introduce* spread at a
  higher tier — a tier upgrading attack shape, not just numbers.
- **grenade** (shooter attack) — `Attack.shape: "lob"`: an arcing projectile that
  bursts in an AoE where it lands, instead of a flat shot. Normal faction (hits the
  player side only).
- **escort** (director formation) — not an entity flag: the director may spend on a
  group that pairs a `static` / slow zoner with a `charger` / `chaser` bodyguard, so
  threat arrives protected. See the director section.

## `enemies.json` definition schema
```
enemies.json = {
  "<id>": {
    name, family, tier,                  // tier: 1 = weakest variant of the family
    behavior,                            // chaser | shooter | charger | swarmer
    static?,                             // shooter only: if true, roots in place (no advance/kite)
    exploder?,                           // charger only: detonates an all-faction AoE on contact (hits hero + enemies); no lunge survival
    stats: { speed, constitution, strength, magic },   // 1–10
    contactDamage,                       // damage on overlap (chaser/swarmer; 0 if none)
    attack?: Attack,                     // spec 04 descriptor; shooter/charger only
    threatValue,                         // spawn-budget cost (director)
    distanceBand,                        // min distance fraction [0,1] at which this def is eligible
    sprite
  }
}
```
- Loaded into the entity registry (spec 03). `spawn('enemy:<id>')` applies
  `stats`, attaches `attack` (if present) to the entity's attack set under the id
  the brain calls (`'shot'`, `'lunge'`), sets `contactDamage`, and resolves
  `brain` via `brainFor`.
- `mana` is attached only when the def's `attack.manaCost > 0`.
- Numbers below are tuning data tied to the balance config, **not contracts**.

## Roster — four families, generic horror
| Family | Behavior | Flavor | Tiers |
|---|---|---|---|
| Shamblers | `chaser` | shuffling zombies; the bread-and-butter melee | 1 Shambler · 2 Ghoul · 3 Revenant |
| Imps | `swarmer` | small fast demons in packs | 1 Imp · 2 Hellpup |
| Cultists | `shooter` | robed casters lobbing dark bolts | 1 Acolyte · 2 Zealot · 3 Hierophant |
| Brutes | `charger` | hulking ghoul-brutes that lunge | 1 Brute · 2 Behemoth |

Tier raises `constitution`/`contactDamage`/attack numbers and `distanceBand`
(elites appear only deep toward home), and costs more `threatValue`.

### Tier-1 example defs
```json
{
  "shambler": {
    "name": "Shambler", "family": "shamblers", "tier": 1,
    "behavior": "chaser",
    "stats": { "speed": 3, "constitution": 4, "strength": 4, "magic": 1 },
    "contactDamage": 6,
    "threatValue": 1, "distanceBand": 0.0, "sprite": "shambler"
  },
  "imp": {
    "name": "Imp", "family": "imps", "tier": 1,
    "behavior": "swarmer",
    "stats": { "speed": 7, "constitution": 2, "strength": 2, "magic": 1 },
    "contactDamage": 3,
    "threatValue": 1, "distanceBand": 0.1, "sprite": "imp"
  },
  "acolyte": {
    "name": "Acolyte", "family": "cultists", "tier": 1,
    "behavior": "shooter",
    "stats": { "speed": 4, "constitution": 3, "strength": 2, "magic": 6 },
    "contactDamage": 0,
    "attack": {
      "name": "Dark Bolt", "shape": "projectile", "scaling": "magic",
      "base": 5, "ratio": 0.6, "manaCost": 8, "cooldown": 1.6,
      "projectile": { "speed": 240, "lifespan": 1.4, "pierce": 0 },
      "effects": []
    },
    "threatValue": 3, "distanceBand": 0.25, "sprite": "acolyte"
  },
  "brute": {
    "name": "Brute", "family": "brutes", "tier": 1,
    "behavior": "charger",
    "stats": { "speed": 4, "constitution": 7, "strength": 7, "magic": 1 },
    "contactDamage": 4,
    "attack": {
      "name": "Lunge Slam", "shape": "melee-arc", "scaling": "strength",
      "base": 12, "ratio": 1.2, "manaCost": 0, "cooldown": 2.5,
      "hitbox": { "arc": 60, "radius": 56 },
      "effects": ["knockback:large"]
    },
    "threatValue": 4, "distanceBand": 0.4, "sprite": "brute"
  }
}
```
A shooter/charger attack id is the key the brain calls (`'shot'` / `'lunge'`);
the loader registers the def's `attack` under that id for the entity.

## Director spawn model (`run/director.js`)
One algorithm, no fallbacks. The director reads player distance and budgets
spawns; it owns no level geometry.

**Distance fraction.** `f = (player.y − start.y) / (home-band.y − start.y)`
along the southward descent axis, clamped to `[0, 1]`. 0 at the north start
edge, 1 at the south home band.

**Budget.** Target live-threat budget scales with `f`:
```
budget(f) = BASE_THREAT + f * THREAT_SLOPE      // monotonic; peaks near home
liveThreat = Σ threatValue of currently-alive enemies
```
Each tick the director spends `budget(f) − liveThreat` (when positive) on new
enemies.

**Eligibility.** A def is eligible iff `def.distanceBand <= f`. Deeper bands
unlock the higher tiers and the ranged/charger families as `f` grows; near home
the full roster is in play.

**Selection & placement.** Per spend:
1. Pick a `Level.region` that is **away from the player's current view** (region
   center outside the camera rect, on the home-ward side preferred).
2. From defs eligible at `f`, pick one whose `threatValue` fits the remaining
   spend (`spawns` sub-stream RNG, spec 01, for reproducibility).
3. `spawn('enemy:<id>')` at a `walkable` tile inside that region; subtract its
   `threatValue` from the spend.

**Escort formation.** A spend may buy a **group** rather than a single enemy: a
`static`/slow zoner placed with one or more `charger`/`chaser` bodyguards in the
same region, so the protected threat arrives as a unit. The group's combined
`threatValue` is what's debited.

Spawns are gated to off-screen regions so threat materializes around the player,
not in front of their eyes. Same seed → same spawn sequence.

## Interfaces this spec freezes
- `brain(entity, world, dt)` contract: reads `world.target` (nearest
  `player`-faction entity — hero or deployable) / `world.walkable`, writes only
  `movement.intent` and `useAttack` calls.
- The four behavior names (`chaser`, `shooter`, `charger`, `swarmer`) and
  `brainFor(def)` selection by `def.behavior`.
- `enemies.json` entry schema above; `family` / `tier` / `threatValue` /
  `distanceBand` fields.
- `spawn('enemy:<id>')` builds an enemy (brain via `brainFor`, `contactDamage`,
  optional `attack` under the brain's attack id, `mana` iff `manaCost > 0`); a
  `static: true` shooter holds movement intent at 0 (roots/zones); an
  `exploder: true` charger detonates an all-faction AoE on contact instead of
  surviving its lunge.
- Director contract: `budget(f)` monotonic in distance fraction `f`,
  `distanceBand` eligibility gate, off-screen region placement, `spawns` RNG
  sub-stream. Enemies enter only via the director into `Level.regions`.
