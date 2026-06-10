# Spec 03 — Entity & stats model

One **unified component schema** for every actor: heroes, enemies, pickups. An
entity is a bag of components; what it *is* depends on which components it has.
Built data-driven from definitions (spec 05) via a factory.

## Components
| Component | Fields | On |
|---|---|---|
| `transform` | x, y (world px), facing (radians/8-dir) | all moving things |
| `movement` | vx, vy, intent (dir vector) | actors |
| `stats` | speed, constitution, strength, magic (base levels) | actors |
| `derived` | computed cache (below) | actors |
| `health` | hp, maxHp | mortal actors |
| `mana` | mana, maxMana, regen | magic users |
| `collider` | w, h, offset (AABB) | solid things |
| `faction` | player \| enemy \| neutral | actors (damage rules) |
| `brain` | AI controller ref | enemies |
| `input` | flag: player-controlled | hero only |
| `sprite` | visual ref, anim state | rendered things |
| `pickup` | effect descriptor, consumed-on-touch | items |

Heroes = transform+movement+stats+derived+health+mana+collider+faction+input+sprite.
Enemies swap `input`→`brain`. Pickups = transform+collider+pickup+sprite.

## Stat → derived mapping (direct)
The four base stats are levels in entity data; `derived` is recomputed from them.
Constants live in a **balance config**, not in code paths — tuning stays data.

```
moveSpeed   = BASE_SPEED  * speedFactor(speed)      // speed → velocity
maxHp       = BASE_HP      + constitution * HP_PER_CON
dmgResist   = clamp(constitution * RESIST_PER_CON, 0, RESIST_CAP)
meleeDamage = BASE_MELEE   + strength * DMG_PER_STR  // strength → melee + knockback
knockback   = strength * KB_PER_STR
maxMana     = BASE_MANA    + magic * MANA_PER_MAG    // magic → power + resource
abilityPower= BASE_AP      + magic * AP_PER_MAG
```
`recomputeDerived(entity)` runs on spawn and after any stat change (level-up,
upgrade, powerup). HP/mana clamp to new maxima. Marvin Merrick = mid value on
all four axes (the average baseline); other heroes deviate — values are content.

## Movement & collision (free-move + AABB)
- `movement.intent` set by `input` (hero) or `brain` (enemy); normalized.
- Integrate: `vx,vy = intent * derived.moveSpeed`. Position += v * dt.
- **Per-axis tile resolution:** move X, push out of overlapping non-`walkable`
  tiles; then move Y, push out. Prevents corner tunneling. Uses `Level.walkable`.
- Entity-entity contact (push/damage) is the combat spec's concern; this spec
  only fixes the collider shape and the actor↔world resolution.

## Factory (`entities/factory.js`)
`spawn(defId, overrides) -> entity`: looks up the definition in the registry
(spec 05), composes the listed components, fills `stats`, runs
`recomputeDerived`. Spawning never hard-codes a creature; it reads data.

## Interfaces this spec freezes
- The component set and field names above
- `derived` formula shape + the named balance constants (values TBD in content)
- `recomputeDerived(entity)` contract (called on spawn + stat change)
- Per-axis AABB-vs-`walkable` resolution as the movement contract
- `spawn(defId, overrides)` factory signature
