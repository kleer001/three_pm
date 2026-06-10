# Spec 05 — Characters: registry format + Marvin

Defines the `content/characters.json` schema and the starter hero, Marvin
Merrick. Each later hero gets its own spec; all conform to this format.

## Stat scale
All hero stats use a **1–10 scale, 5 = average baseline**. Marvin sits at 5 on
every axis by definition; other heroes deviate around him. The balance config
(spec 03) maps these levels to derived values.

## Character definition schema
```
characters.json = {
  "<id>": {
    name, archetype, blurb,
    unlockAtRuns,                      // 0 = starter; others ascending (set per hero spec)
    stats: { speed, constitution, strength, magic },   // 1–10
    basic:     Attack,                 // manaCost 0 (spec 04 schema)
    signature: Attack,                 // manaCost > 0 + cooldown
    sprite                             // visual id
  }
}
```
- Loaded into the entity registry (spec 03). `spawn('hero:<id>')` builds the
  actor: applies `stats`, attaches `basic`/`signature` to its attack set.
- **Unlock:** the meta system (spec 06) compares `meta.runCount` to each
  `unlockAtRuns`; any hero at/under the count is playable. Marvin = 0.
- Projectile spread shots extend spec 04's `projectile` with `count` + `spread`.

## Marvin Merrick — "The Median"
The aggressively average sophomore. B-minus at everything, including survival.
The onboarding hero: no spikes, no holes, forgiving to learn on.

```json
"marvin": {
  "name": "Marvin Merrick",
  "archetype": "The Median",
  "blurb": "Perfectly, terrifyingly average. The watch is the only special thing he owns.",
  "unlockAtRuns": 0,
  "stats": { "speed": 5, "constitution": 5, "strength": 5, "magic": 5 },
  "basic": {
    "name": "Backpack Swing",
    "shape": "melee-arc",
    "scaling": "strength",
    "base": 4, "ratio": 1.0,
    "manaCost": 0, "cooldown": 0.45,
    "hitbox": { "arc": 90, "radius": 40 },
    "effects": ["knockback:small"]
  },
  "signature": {
    "name": "Pop Quiz",
    "shape": "projectile",
    "scaling": "magic",
    "base": 3, "ratio": 0.8,
    "manaCost": 25, "cooldown": 3.0,
    "projectile": { "speed": 320, "lifespan": 1.2, "pierce": 0, "count": 3, "spread": 20 },
    "effects": []
  },
  "sprite": "marvin"
}
```
- **Backpack Swing:** a wide, slow-ish melee arc — reliable, unremarkable, the
  baseline melee all other heroes are read against.
- **Pop Quiz:** fans three #2-pencil projectiles along the aim. Mid mana, mid
  cooldown, mid damage — the average ranged option.

Numbers are starting values tied to the balance config; they are tuning data,
not contracts.

## Interfaces this spec freezes
- `characters.json` entry schema above
- 1–10 stat scale with 5 = baseline (Marvin all-5s)
- `spawn('hero:<id>')` builds from a character def
- `unlockAtRuns` as the per-hero gate the meta system reads
- `projectile.count` / `projectile.spread` extension to spec 04
