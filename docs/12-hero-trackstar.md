# Spec 12 — Hero: The Track Star

Defines the unlockable hero **Dash Velocity "The Track Star"**, a fast skirmisher
built for hit-and-run. Conforms to the `characters.json` entry schema (spec 05);
uses the `Attack` descriptor (spec 04) and the 1–10 stat scale (spec 03).

## Decisions in force
- Slot: **fast skirmisher** — mobility, dodge uptime, hit-and-run. Not a bruiser,
  not a caster. Reward is *speed and uptime*, not burst.
- **Hard specialist:** SPEED peak, CONSTITUTION dump. Mistimed aggression is
  punishing; clean kiting is dominant.
- `unlockAtRuns: 5` — the first earned hero past Marvin.
- Kit is stats + `basic` + `signature` only. **No passives.**
- `basic` scales on strength, `manaCost 0`, short cooldown to reward weaving
  attacks between repositions.
- `signature` is a mobility power: a dash that repositions, deals light contact
  damage, and grants brief i-frames. It conforms to the `Attack` schema and
  `scaling: magic` per spec 04, but its identity is *repositioning*, not damage.

## Dash Velocity — "The Track Star"
State-meet 400m champ who treats every fight like a relay leg. Fragile as glass,
faster than anything that wants to hit her. Played absurd: never stand still.

### Stats — `speed 9 / constitution 2 / strength 5 / magic 4`
| Stat | Level | Rationale |
|---|---|---|
| speed | 9 | Peak. The whole identity — outpaces every enemy and most projectiles. |
| constitution | 2 | Dump. Lowest HP and near-zero resist; two clean hits and she's done. |
| strength | 5 | Middling. Basic hits like Marvin's — fine, not the point. |
| magic | 4 | Low-middling. Small mana pool; the dash is cheap so uptime stays high. |

```json
"dash_velocity": {
  "name": "Dash Velocity",
  "archetype": "The Track Star",
  "blurb": "State champ in the 400. Faster than anything that wants to hit her, and she knows it.",
  "unlockAtRuns": 5,
  "stats": { "speed": 9, "constitution": 2, "strength": 5, "magic": 4 },
  "basic": {
    "name": "Baton Jab",
    "shape": "melee-arc",
    "scaling": "strength",
    "base": 3, "ratio": 1.0,
    "manaCost": 0, "cooldown": 0.25,
    "hitbox": { "arc": 60, "radius": 32 },
    "effects": []
  },
  "signature": {
    "name": "Anchor Leg",
    "shape": "melee-arc",
    "scaling": "magic",
    "base": 2, "ratio": 0.5,
    "manaCost": 15, "cooldown": 1.5,
    "hitbox": { "arc": 360, "radius": 28 },
    "effects": ["dash:far", "iframes:short", "knockback:small"]
  },
  "sprite": "dash_velocity"
}
```
- **Baton Jab:** a narrow, near-instant melee poke on a very short cooldown. Low
  per-hit damage; the point is throwing several between dashes without committing.
- **Anchor Leg:** a long forward dash along `aim` that grants a short i-frame
  window and lightly damages anything brushed along the path (360° hitbox swept by
  the move). Cheap mana, low cooldown — meant to be spammed for repositioning and
  dodging, not as a nuke. Payoff is being everywhere and never getting hit.

Numbers are starting values tied to the balance config; they are tuning data,
not contracts.

## Interfaces this spec freezes
- The `dash_velocity` character entry conforms to spec 05's `characters.json` schema.
- `unlockAtRuns: 5` as this hero's meta gate (spec 06 reads it).
- `dash:far` / `iframes:short` as `effects` tokens the attack resolver (spec 04)
  applies — dash translates the caster along `aim`; iframes set `health.iframes`.
