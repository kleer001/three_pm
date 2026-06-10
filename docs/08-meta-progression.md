# Spec 08 — Meta-progression + save schema

Defines the durable tier: the persistent save blob, the `meta/save.js` API, the
end-of-run payout, per-hero permanent upgrade trees, and the hero-unlock flow.
This is the `meta/save` module reserved in spec 01. Run results flow Run → Meta
only at the DEATH/VICTORY scenes (spec 01 scene FSM); nothing else writes meta.

## Decisions in force
- **One meta-currency, `credits`**, banked at run end — a separate end-of-run
  payout scaled by distance reached, kills, and a win bonus. It is **distinct**
  from the in-run `scrap` (spec 07): `scrap` is volatile and dropped on death;
  `credits` persist. The two never convert.
- **Per-hero permanent upgrade trees.** Each hero has its own track bought with
  `credits`. An upgrade modifies that hero's **run-start state** (base stats,
  starting mana, starting powerup slots) before the run begins.
- The save persists: unlocked heroes (derived, see below), banked `credits`,
  purchased upgrades per hero, and run stats (wins, best distance, total kills,
  run count). One versioned JSON blob under one localStorage key.
- **Fixed difficulty.** No day-difficulty tiers, no run modifiers, no heat. Not
  designed here.

## Save schema (`meta/save.js`)
One JSON blob, one key, one version field for migration.

```
KEY = "threepm:save"

SaveBlob {
  version: 1,
  credits: 0,                          // banked meta-currency
  runCount: 0,                         // completed runs (death OR victory)
  unlockedHeroes: ["marvin"],          // cache of ids; recomputed from runCount
  heroUpgrades: {                      // heroId -> { upgradeId -> rank }
    "<heroId>": { "<upgradeId>": <rank:int> }
  },
  stats: {
    wins: 0,
    bestDistance: 0,                   // best distance fraction reached, 0..1
    totalKills: 0
  }
}
```
- `unlockedHeroes` is a **derived cache**, not the source of truth: the gate is
  always `runCount >= hero.unlockAtRuns` (spec 05). The cache is rewritten after
  every `recordRun` so the META scene can list ids without re-scanning defs.
- **Migration:** on `load`, if `blob.version < CURRENT`, run ordered migration
  steps `v → v+1` that add/rename fields with defaults; a missing or unparsable
  blob yields a fresh default at `CURRENT`.

## API (`meta/save.js`)
Pure builders for the blob; one write path to localStorage. Mutators read the
current blob, return the next blob, and persist via the single `save`.

```
load() -> SaveBlob               // parse KEY, migrate to CURRENT, or default
save(blob)                       // serialize + write KEY  (the only writer)

bankCurrency(blob, n) -> blob    // credits += n
recordRun(blob, result) -> blob  // see Payout + Unlock below
purchaseUpgrade(blob, heroId, upgradeId) -> blob
isHeroUnlocked(blob, heroId) -> bool   // runCount >= def.unlockAtRuns
```
- `result = { distanceFraction: 0..1, kills, won: bool }` — the run summary the
  DEATH/VICTORY scenes hand off. It carries no live `runState`; the run tier is
  already discarded by the time meta is written.
- `bankCurrency` / `recordRun` / `purchaseUpgrade` are pure transforms; the
  caller persists the returned blob with `save`. DEATH/VICTORY call
  `save(recordRun(load(), result))` — load, transform, write, once.

## End-of-run payout (`recordRun`)
`credits` earned this run, added on top of the bank. Coefficients are **tuning
data, not contract**.

```
PAYOUT_DISTANCE = 100   // credits at full distance (fraction 1.0)
PAYOUT_PER_KILL = 2
PAYOUT_WIN      = 150   // flat bonus when won

payout = round(result.distanceFraction * PAYOUT_DISTANCE
               + result.kills * PAYOUT_PER_KILL
               + (result.won ? PAYOUT_WIN : 0))
```
`recordRun(blob, result)` folds in one transaction:
```
recordRun(blob, result):
  blob.credits        += payout(result)
  blob.runCount       += 1
  blob.stats.wins     += result.won ? 1 : 0
  blob.stats.totalKills += result.kills
  blob.stats.bestDistance = max(bestDistance, result.distanceFraction)
  blob.unlockedHeroes  = recomputeUnlocks(blob.runCount)   // below
  return blob
```

## Per-hero upgrade trees (`content/upgrades.json`)
A separate file keyed by hero id, **not** inlined in the character def: the
character def (spec 05) is immutable run content; upgrades are a meta concern
with their own cost/rank tuning, so they live apart and are joined by id.

```
upgrades.json = {
  "<heroId>": {
    "<upgradeId>": {
      name, blurb,
      maxRank,                 // integer; rank 0 = unpurchased
      costCurve: [c1, c2, ...],// length == maxRank; credits to buy rank i (1-based)
      apply: { ... }           // run-start modifier, scaled by purchased rank
    }
  }
}
```
The `apply` payload mirrors the spec 07 `stat` payload so the run-start path
reuses existing math — deltas on the hero's base `stats`, plus two meta-only
run-start fields:

| `apply` field | Applied at run start |
|---|---|
| `speed?` `constitution?` `strength?` `magic?` | `stats[k] += delta * rank` (1–10 scale, spec 05) |
| `startMana?` | `mana.mana += startMana * rank` (clamped to `maxMana` after derive) |
| `startSlots?` | reserved powerup slots added to `runState.powerups` capacity * rank |

`purchaseUpgrade(blob, heroId, upgradeId)`:
```
def  = upgrades[heroId][upgradeId]
rank = blob.heroUpgrades[heroId]?.[upgradeId] ?? 0
if rank >= def.maxRank: return blob              // maxed; no-op
cost = def.costCurve[rank]                        // next rank's price
if blob.credits < cost: return blob               // can't afford; no fallback
blob.credits -= cost
blob.heroUpgrades[heroId][upgradeId] = rank + 1
return blob
```

### Applying upgrades at run start
At `RUN.enter()`, after `spawn('hero:<id>')` (spec 03) builds the hero from the
character def and **before** `recomputeDerived`:
```
applyHeroUpgrades(hero, heroId, blob):
  for upgradeId, rank in blob.heroUpgrades[heroId]:
    def = upgrades[heroId][upgradeId]
    for k in {speed, constitution, strength, magic} ∩ def.apply:
      hero.stats[k] += def.apply[k] * rank
    if def.apply.startMana: hero._startMana = def.apply.startMana * rank
  recomputeDerived(hero)                  // maxHp/maxMana/... from upgraded stats
  hero.mana.mana = clamp(BASE + hero._startMana, 0, hero.maxMana)
```
Stat deltas go in before `recomputeDerived` so derived values reflect them; mana
seeding happens after, against the freshly derived `maxMana`. This is the same
`recomputeDerived` path spec 03 freezes — meta upgrades are just another stat
source, applied once at run start instead of mid-run like powerups.

## Unlock flow
After `recordRun` bumps `runCount`, recompute the unlock set and surface any
newcomer to the META scene.
```
recomputeUnlocks(runCount):
  return [ id for id in characters where runCount >= characters[id].unlockAtRuns ]
```
- `recordRun` writes the new set to `blob.unlockedHeroes`. The DEATH/VICTORY
  scene diffs old vs new and emits `meta:hero-unlocked` (spec 01 events) per new
  id, so the META scene can announce it. No other system computes unlocks.
- Marvin (`unlockAtRuns: 0`) is unlocked from the first load.

## META scene consumption (between runs, spec 01)
The META scene is read-through-`load`, write-through-`save`:
- **Spend:** show each unlocked hero's `upgrades.json` tree with current rank and
  next `costCurve` cost; a buy calls `save(purchaseUpgrade(load(), heroId, id))`.
- **Unlocks:** list `blob.unlockedHeroes`; react to `meta:hero-unlocked` events
  from the resolution scene to highlight the new arrival.
- **Pick:** the selected (unlocked) hero id is handed to the next `RUN.enter()`,
  which spawns it and runs `applyHeroUpgrades` from the same `load()`.

## Interfaces this spec freezes
- `SaveBlob` shape + `KEY = "threepm:save"` + the `version`/migration contract
  (fills the `{ version, ... }` reserved in spec 01).
- `meta/save.js` API: `load`, `save` (sole writer), and pure mutators
  `bankCurrency`, `recordRun(result)`, `purchaseUpgrade(heroId, upgradeId)`,
  `isHeroUnlocked(heroId)`.
- `result = { distanceFraction, kills, won }` as the only Run → Meta payload,
  consumed only at DEATH/VICTORY.
- `credits` as the banked meta-currency, distinct from spec 07 `scrap`.
- `upgrades.json` schema (`maxRank` / `costCurve` / `apply`) and
  `applyHeroUpgrades(hero, heroId, blob)` applied before `recomputeDerived`
  (spec 03) at run start.
- Unlock rule `runCount >= unlockAtRuns` (spec 05) via `recomputeUnlocks`;
  `meta:hero-unlocked` event as the surfacing channel.
