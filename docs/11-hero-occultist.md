# Spec 11 — Hero: The Occultist

Defines the unlockable glass-cannon mage hero, conforming to the
`characters.json` entry schema frozen in spec 05. Stats use the 1–10 scale
(5 = baseline); derived values come from the balance config (spec 03);
`basic`/`signature` are `Attack` descriptors (spec 04).

## Decisions in force
- **Slot:** glass-cannon mage — the roster's highest magic output, lowest
  survivability. Read against Marvin's all-5 baseline.
- **Hard specialist:** MAGIC peak, CONSTITUTION dump. No middle ground; the
  hero either deletes the room or dies to one mistake.
- **No passives.** Identity lives entirely in stats + the two attacks.
- **Unlock:** `unlockAtRuns: 3`. Earned, not starter.
- The basic scales on `magic` (not `strength`) so the hero is never disarmed
  when out of mana — a mage with a melee basic would be off-fantasy and
  off-archetype.

## Wendolyn Crowe — "The Occultist"
A goth sophomore who dresses the part for attention and turns out to mean every
word of it. Pours absurd magic damage downrange and folds the instant anything
touches her. High ceiling, paper floor.

```json
"wendolyn": {
  "name": "Wendolyn Crowe",
  "archetype": "The Occultist",
  "blurb": "Everyone thought it was a phase. The thing in the parking lot disagrees.",
  "unlockAtRuns": 3,
  "stats": { "speed": 5, "constitution": 2, "strength": 3, "magic": 9 },
  "basic": {
    "name": "Hex Bolt",
    "shape": "projectile",
    "scaling": "magic",
    "base": 3, "ratio": 1.1,
    "manaCost": 0, "cooldown": 0.5,
    "projectile": { "speed": 360, "lifespan": 1.4, "pierce": 0, "count": 1, "spread": 0 },
    "effects": []
  },
  "signature": {
    "name": "Summon the Hall Monitor",
    "shape": "nova",
    "scaling": "magic",
    "base": 14, "ratio": 2.4,
    "manaCost": 45, "cooldown": 6.0,
    "hitbox": { "radius": 130 },
    "effects": ["knockback:large", "status:burn"]
  },
  "sprite": "wendolyn"
}
```
- **Stats:** MAGIC 9 (peak output + deepest mana pool), CONSTITUTION 2 (lowest
  HP/resist on the roster — dies fast), STRENGTH 3 (no melee fallback by
  design), SPEED 5 (baseline footwork; not a skirmisher, can't kite forever).
- **Hex Bolt:** a free, single magic-scaling projectile on a short cooldown. No
  mana means she always has an answer, but `ratio 1.1` on a fragile body rewards
  landing every shot rather than spamming.
- **Summon the Hall Monitor:** a high-mana, long-cooldown nova centered on the
  hero — rips a ring out of summoned authority around her, knocks back, and
  burns. Huge `base`/`ratio` for clearing packs, but it costs nearly half the
  pool and plants her in melee range with CON 2. Risk/reward made literal.

Numbers are starting values tied to the balance config; tuning data, not
contracts.

## Interfaces this spec freezes
- Nothing new. This hero is content conforming to spec 05's `characters.json`
  entry schema and spec 04's `Attack` descriptor; it freezes no interfaces.
