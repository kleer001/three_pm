# Spec 07 — In-run powerups (pickups)

Defines the powerup system: the `content/powerups.json` schema, how a powerup
applies to the hero, how stacks accumulate, the synergy model, and the two
acquisition channels — world drops and shops. Powerups are run-scoped buffs the
hero collects during a day. They reuse the spec 03 entity model and the spec 04
attack machinery; this spec adds no new combat math.

## Decisions in force
- A powerup does **both kinds of thing**: it modifies the four base stats *and/or*
  grants/modifies attacks (extra projectile, pierce, wider arc, new on-hit
  effects). One schema covers all of it.
- **Whole-run permanent**: a powerup is kept from pickup until the run ends
  (death or reaching home). It lives in `runState` (spec 01) and is dropped with
  it between runs. There is no in-run loss.
- **Two acquisition channels**: world **drops** (enemies and containers drop
  pickup entities) and **shops** (spend an in-run currency at shop spots placed
  in the map). Both end in the same `applyPowerup` call.
- **Stacks with synergies**: picking up the same powerup again stacks it; named
  combinations of held powerups produce emergent effects. Both are data-driven —
  no per-powerup special cases in code.

## `content/powerups.json` definition schema
```
powerups.json = {
  "<id>": {
    name, blurb,
    rarity,                  // common | uncommon | rare  (drop-weight + shop-cost tier)
    kind,                    // stat | attack | effect
    target,                  // attack mods only: "basic" | "signature"
    mods: { ... },           // payload, shape depends on kind (below)
    stackable,               // true: re-pickup re-applies; false: dedupe, ignore re-pickup
    cost,                    // shop price in in-run currency
    sprite
  }
}
```
The `mods` payload by `kind`:

| kind | `mods` shape | Applied as |
|---|---|---|
| `stat` | `{ speed?, constitution?, strength?, magic? }` (deltas, stat-levels) | add to `entity.stats`, then `recomputeDerived` |
| `attack` | partial `Attack` fields keyed to override/add on `target`'s descriptor | merge into the `basic`/`signature` `Attack` (spec 04) |
| `effect` | `{ effects: [ ... ] }` — spec 04 effect tags to append on-hit | append to `target`'s `Attack.effects` |

- `attack` and `effect` both rewrite an `Attack` descriptor and so require
  `target`; `stat` never has a `target`. The loader validates this at boundary.
- Numbers in any payload are tuning data tied to the balance config (spec 03),
  **not contracts**.

## Applying a powerup (`run/powerups.js`)
One pure function, no fallbacks:
```
applyPowerup(entity, def)
  kind === 'stat':
    for each k in def.mods: entity.stats[k] += def.mods[k]
    recomputeDerived(entity)               // re-derives maxHp/moveSpeed/... ; hp/mana clamp
  kind === 'attack':
    atk = entity.attacks[def.target]       // 'basic' | 'signature'
    applyAttackMod(atk, def.mods)          // numeric fields add; projectile.count/pierce add; geometry overrides
  kind === 'effect':
    entity.attacks[def.target].effects.push(...def.mods.effects)
```
`applyAttackMod` adds numeric `Attack` fields (`base`, `ratio`, `cooldown`,
`projectile.count`, `projectile.pierce`, `hitbox.arc`, …) and overrides
non-numeric ones; it is the single rule attack-powerups go through.

### Stacking: held list + rebuild from base
`runState.powerups` is the ordered list of held powerup **ids** (with repeats for
stackables). On every acquisition the system **rebuilds the hero from base**:
```
applyHeld(entity)
  reset entity.stats   ← character def base (spec 05)
  reset entity.attacks ← character def basic/signature (deep copy)
  for id in runState.powerups: applyPowerup(entity, defs[id])
  applySynergies(entity, runState.powerups)   // below
  recomputeDerived(entity)
```
Rebuild-from-base (not incremental mutation) because synergies depend on the
*whole* held set and attack mods are non-commutative once geometry is overridden;
recomputing keeps one source of truth and makes order-independence explicit.
A non-`stackable` def already present in `runState.powerups` is dropped before
rebuild, so duplicates of it are no-ops.

## Synergies (`content/synergies.json`)
Declarative table keyed by the **set** of held powerup ids a combo requires. The
engine detects satisfied combos and applies each combo's own powerup-style mod;
there are no hardcoded combo branches in code.
```
synergies.json = {
  "<synergyId>": {
    name, blurb,
    requires: [ "<id>", "<id>", ... ],   // all must be held (stacks count as held)
    kind, target, mods                    // same payload contract as a powerup def
  }
}
```
```
applySynergies(entity, held)
  heldSet = set(held)
  for s in synergies (stable order):
    if every id in s.requires ∈ heldSet:
      applyPowerup(entity, s)             // same function; a synergy IS a powerup mod
```
A synergy reuses `applyPowerup` verbatim — it is just a powerup gated on a
held-set instead of a pickup. Adding a combo is a JSON edit, never a code path.

## Drops (`run/loot.js`)
The loot system listens for the spec 04 `death` event and rolls a drop using the
`loot` RNG sub-stream (spec 01) — never `gen`/`spawns`, so loot stays reproducible
and independent of world-gen and the director.
```
on('death', (target, source) => {
  if target.faction !== 'enemy': return
  if rng('loot').chance(dropChanceFor(target)): // tier/threatValue → chance
    id = rng('loot').pick(weightedByRarity(LOOT_TABLE))
    spawnPickup(id, target.transform)            // pickup entity at death position
})
```
- `dropChanceFor` scales with the dead enemy's tier/`threatValue` (elites drop
  more often); the weighting favors `common` over `rare`. Both are balance config.
- **Containers** (a `loot`-tagged scenery entity placed in `Level.regions`,
  spec 02) emit the same `death` event when destroyed, so containers and enemies
  share one drop path — no second loot system.

`spawnPickup(id, transform)` builds a pickup entity (spec 03: `transform +
collider + pickup + sprite`). Its `pickup` component is
`{ effect: { type: 'powerup', defId: id }, consumed: true }`. On hero overlap the
pickup system reads the effect, appends `id` to `runState.powerups`, calls
`applyHeld(hero)`, and despawns the pickup.

## Shops (`run/shop.js`)
- **Currency.** One in-run currency, `runState.scrap`, earned from kills and
  destroyed containers (a fixed amount per `death` of an `enemy`/container,
  tracked by the same `death` listener) and dropped with `runState` on death.
  No second currency, no banking — meta currency is a different, later spec.
- **Shop spots.** Placed by levelgen as a `shop`-tagged entry in `Level.regions`
  (spec 02). At run start the shop system spawns a shop interactable at each spot
  and rolls its stock from the loot table via the `loot` sub-stream: N powerup
  defs at their `cost`.
- **Purchase.** On hero interaction with a shop offering id `i`:
```
buy(hero, shop, i)
  def = shop.stock[i]
  if runState.scrap < def.cost: return     // not enough; no fallback, no partial buy
  runState.scrap -= def.cost
  runState.powerups.push(def.id)
  applyHeld(hero)
  remove i from shop.stock                  // one-time stock
```
A purchase ends in the same `applyHeld` rebuild as a world pickup; drops and
shops differ only in how `id` reaches `runState.powerups`.

## Example powerup set
Realistic placeholder numbers — tuning data, not contracts.
```json
{
  "espresso_shot": {
    "name": "Espresso Shot", "blurb": "+move speed.",
    "rarity": "common", "kind": "stat",
    "mods": { "speed": 1 }, "stackable": true, "cost": 15, "sprite": "pu_espresso"
  },
  "thick_skin": {
    "name": "Thick Skin", "blurb": "+constitution (HP + resist).",
    "rarity": "common", "kind": "stat",
    "mods": { "constitution": 1 }, "stackable": true, "cost": 15, "sprite": "pu_skin"
  },
  "split_shot": {
    "name": "Split Shot", "blurb": "Signature fires +1 projectile, tighter spread.",
    "rarity": "uncommon", "kind": "attack", "target": "signature",
    "mods": { "projectile": { "count": 1, "spread": -4 } },
    "stackable": true, "cost": 30, "sprite": "pu_split"
  },
  "needle_tip": {
    "name": "Needle Tip", "blurb": "Signature projectiles pierce +1 enemy.",
    "rarity": "uncommon", "kind": "attack", "target": "signature",
    "mods": { "projectile": { "pierce": 1 } },
    "stackable": true, "cost": 30, "sprite": "pu_needle"
  },
  "wide_swing": {
    "name": "Wide Swing", "blurb": "Wider basic melee arc.",
    "rarity": "common", "kind": "attack", "target": "basic",
    "mods": { "hitbox": { "arc": 30 } },
    "stackable": true, "cost": 20, "sprite": "pu_wide"
  },
  "static_charge": {
    "name": "Static Charge", "blurb": "Basic attack now stuns on hit.",
    "rarity": "rare", "kind": "effect", "target": "basic",
    "mods": { "effects": ["status:stun:0.4"] },
    "stackable": false, "cost": 50, "sprite": "pu_static"
  }
}
```
And one synergy pair (`split_shot` + `needle_tip`): a fanned, piercing signature
becomes a wall of skewers.
```json
{
  "skewer_volley": {
    "name": "Skewer Volley",
    "blurb": "Piercing spread shots gain bonus damage per pierce.",
    "requires": ["split_shot", "needle_tip"],
    "kind": "attack", "target": "signature",
    "mods": { "base": 4, "projectile": { "pierce": 1 } }
  }
}
```

## Interfaces this spec freezes
- `powerups.json` entry schema (`rarity` / `kind` / `target` / `mods` /
  `stackable` / `cost`) and the per-`kind` `mods` payload contract.
- `applyPowerup(entity, def)` as the single application function (stats →
  `recomputeDerived`; attack/effect → rewrite the `basic`/`signature` `Attack`).
- `runState.powerups` (held id list, repeats = stacks) and `applyHeld(entity)`
  rebuild-from-base as the stacking contract.
- `synergies.json` schema and `applySynergies` — a synergy is an `applyPowerup`
  mod gated on a held-set; no code-path special cases.
- Drop path: `loot` sub-stream rolls on the spec 04 `death` event;
  `spawnPickup(id, transform)` builds a spec 03 `pickup` entity; overlap appends
  to `runState.powerups` and calls `applyHeld`.
- Shop path: `runState.scrap` single in-run currency; `shop`-tagged
  `Level.regions` entries; `buy(hero, shop, i)` ends in `applyHeld`.
