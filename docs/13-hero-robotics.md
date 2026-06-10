# Spec 13 — Hero: The Robotics Nerd

Defines the unlockable zoner / control-tank hero, conforming to the
`characters.json` entry schema frozen in spec 05. Stats use the 1–10 scale
(5 = baseline); derived values come from the balance config (spec 03);
`basic`/`signature` are `Attack` descriptors (spec 04).

## Decisions in force
- **Slot:** zoner / control-tank — area denial through deployables. Slow and
  durable; doesn't chase, makes the room come to it and bleed on the way in.
- **Dual-leaning specialist:** CONSTITUTION and MAGIC both high (tech reskinned
  as "magic" — the gadget-power stat); SPEED dumped, STRENGTH low. Survives in
  place and out-builds, rather than out-runs or out-punches.
- **Stat spread (1–10, 5 = baseline):**
  - `magic: 8` — high. Deep `maxMana` + `abilityPower`; powers and pays for the deployable.
  - `constitution: 8` — high. Big `maxHp` + `dmgResist`; anchors a position under fire.
  - `speed: 2` — dump. Slowest on the roster; commits to ground, can't kite.
  - `strength: 3` — low. The melee basic is a stopgap, not a win condition.
- **Unlock:** `unlockAtRuns: 8`. The last and hardest hero earned — the deepest
  meta gate on the roster.
- No passives. Kit is stats + `basic` + `signature` only.

## Eugene "Sparkplug" Okafor — "The Robotics Nerd"
Robotics-club president, three regional trophies, zero chill. Can't run, can't
punch, won't need to — he carpets the floor with turrets and lets the math do
the killing. Where the Occultist deletes the room and the Varsity occupies it,
Eugene *furnishes* it: stand on the anchor, feed mana, watch the deployables
zone everything that approaches.

```json
"robotics": {
  "name": "Eugene Okafor",
  "archetype": "The Robotics Nerd",
  "blurb": "Three regional trophies and a backpack full of half-soldered turrets. Brings the whole club to a knife fight.",
  "unlockAtRuns": 8,
  "stats": { "speed": 2, "constitution": 8, "strength": 3, "magic": 8 },
  "basic": {
    "name": "Wrench Whack",
    "shape": "melee-arc",
    "scaling": "strength",
    "base": 3, "ratio": 0.8,
    "manaCost": 0, "cooldown": 0.5,
    "hitbox": { "arc": 80, "radius": 34 },
    "effects": ["knockback:small"]
  },
  "signature": {
    "name": "Deploy Sentry Turret",
    "shape": "deploy",
    "scaling": "magic",
    "base": 0, "ratio": 0,
    "manaCost": 40, "cooldown": 4.0,
    "deploy": {
      "spawnDef": "deployable:sentry_turret",
      "faction": "player",
      "lifespan": 10.0,
      "maxActive": 2,
      "placement": "aim",
      "turret": {
        "scaling": "magic",
        "base": 2, "ratio": 0.7,
        "attack": "projectile",
        "fireRate": 1.2,
        "range": 220,
        "projectile": { "speed": 300, "lifespan": 0.9, "pierce": 0 }
      }
    },
    "effects": []
  },
  "sprite": "robotics"
}
```
- **Stats:** MAGIC 8 (deep mana pool + `abilityPower` that scales the turrets),
  CONSTITUTION 8 (front-line HP/resist so he can stand on his own deployables),
  STRENGTH 3 (melee is a panic poke, not a plan), SPEED 2 (dump — the slowest
  hero; positioning is a one-time commitment, not a kite).
- **Wrench Whack:** a free, modest `strength`-scaling melee arc on a short
  cooldown. Deliberately weak — it exists so a cornered builder isn't fully
  disarmed, not as a damage source. Reads below Marvin's Backpack Swing.
- **Deploy Sentry Turret:** the identity. A `deploy`-shape signature that costs
  no damage of its own (`base`/`ratio` 0); instead it spawns a **friendly
  (`faction: player`) deployable entity** at the aim point via the spec 03
  factory (`spawn('deployable:sentry_turret', …)`). The turret is an ordinary
  entity — transform + collider + faction + a `brain`-style controller — that
  periodically calls `useAttack` against the nearest enemy in `range`, firing a
  `magic`-scaling projectile built from its `turret.*` fields and the deployer's
  `abilityPower`. It despawns on `lifespan` expiry. `maxActive: 2` caps standing
  turrets; deploying a third despawns the oldest. Per-shot numbers are low and
  the `fireRate` slow — this is **zoning and chip, not burst**. Mid-high mana, a
  short cooldown so the field can be re-anchored as fights move.

The deployable reuses existing machinery wholesale: it is a faction-tagged
entity (spec 03), it deals damage through the one `useAttack` /
`applyDamage` resolver (spec 04), and faction rules let its `player` shots hit
`enemy` actors only — exactly like a hero's own projectiles. No new combat path.

Numbers are starting values tied to the balance config; they are tuning data,
not contracts.

## Interfaces this spec freezes
- The `robotics` entry conforming to spec 05's `characters.json` schema
- `unlockAtRuns: 8` as this hero's meta gate
- `Attack.shape: deploy` — a signature that spawns a persistent friendly entity
  instead of (or before) dealing direct damage
- The `deploy` block on a `deploy`-shape Attack: `spawnDef`, `faction`,
  `lifespan`, `maxActive`, `placement`, and a nested `turret` descriptor whose
  fields drive the deployed entity's periodic `useAttack`
- `deployable:<id>` as a factory definition namespace (spec 03), spawned with a
  `brain`-style controller and `faction: player`
